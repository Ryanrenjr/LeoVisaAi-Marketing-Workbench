import "server-only";
import { selectModel } from "./model-selection";
import { getModelRoutingConfig } from "./model-config";
import { getModel } from "./providers/registry";
import {
  runAnthropicResearch,
  runAnthropicContentTask,
  runAnthropicWechatFullArticle,
  generateAnthropicStructured,
} from "./providers/anthropic-provider";
import { runGoogleResearch, generateGoogleStructured } from "./providers/google-provider";
import { generateGroqStructured } from "./providers/groq-provider";
import { generateOpenRouterStructured } from "./providers/openrouter-provider";
import { generateOpenAIStructured, generateOpenAIImage, generateOpenAIImageEdit } from "./providers/openai-provider";
import { buildSourceManifest, buildEvidenceContextBlock, buildOutlineContextBlock, buildRevisionContextBlock } from "./content-schemas";
import { applyGroundingAndSafety, CONTENT_TASK_CONFIG, REVISION_TASK_CONFIG, WECHAT_FULL_ARTICLE_SYSTEM_PROMPT, WechatFullArticleSchema } from "./content-schemas";
import { runResearchSearch, resolveSearchProvider } from "../search/router";
import { isSearchProviderConfigured } from "../search/registry";
import { extractOfficialSources } from "../search/extraction";
import {
  buildResearchSearchQueries,
  buildOptimizationSearchQueries,
  dedupeSearchResultsByUrl,
  rankSearchResults,
  tagSearchHitsByLane,
  selectOfficialExtractionTargets,
  buildExtractionQuery,
  MAX_OFFICIAL_EXTRACTS,
} from "./research-queries";
import {
  RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT,
  ResearchQueryPlanSchema,
  buildResearchQueryPlannerUserPrompt,
  planToResearchSearchQueries,
} from "./research-query-planner";
import {
  EXTERNAL_RESEARCH_SYSTEM_PROMPT,
  ExternalResearchClaimSchema,
  buildExternalGroundedPack,
  buildExternalResearchUserPrompt,
  buildSearchResultManifest,
} from "./research-external";
import {
  RESEARCH_OPTIMIZATION_SYSTEM_PROMPT,
  ResearchOptimizationContentClaimSchema,
  buildResearchOptimizationUserPrompt,
  buildOptimizedContent,
  RESEARCH_AUDIT_SYSTEM_PROMPT,
  ResearchAuditClaimSchema,
  buildResearchAuditUserPrompt,
  combineAuditedOptimizationPack,
} from "./research-optimization";
import type { OptimizedResearchPack } from "./research-optimization";
import type { EvidenceInput } from "./content-agent";
import type { GroundedResearchPack } from "./research-pack";
import type {
  VideoChannelContent,
  XiaohongshuContent,
  XiaohongshuPagesPlan,
  WechatOutline,
  WechatFullArticle,
  WechatArticle,
  GenericContentTaskType,
  RevisionTaskType,
  Groundable,
} from "./content-schemas";
import {
  COMPLIANCE_SYSTEM_PROMPT,
  ComplianceReviewSchema,
  buildComplianceContextBlock,
  mergeComplianceFindings,
  overallRiskFor,
  scanTextForComplianceFindings,
} from "./compliance-schemas";
import type { ComplianceReview } from "./compliance-schemas";
import {
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
  DirectedTopicDiscoveryResultSchema,
  AutoTopicDiscoveryResultSchema,
  AutoSparseTopicDiscoveryResultSchema,
  buildDiscoveryManifest,
  buildDiscoveryQueries,
  buildTopicDiscoveryUserPrompt,
  filterCandidatesByValidLabels,
  poolDiscoveryResults,
  hasSufficientAutoEvidence,
} from "./topic-discovery";
import type { TopicDiscoveryResult } from "./topic-discovery";
import { getEmployeeInstruction } from "../employee-instructions";
import { appendCustomInstructions } from "./prompt-addendum";
import { buildSkillPrompt } from "./skills";
import type { SearchProviderId } from "../search/types";
import { TASK_TYPE_EMPLOYEE } from "./providers/types";
import type { AIExecutionResult, AIProviderId, ModelRef, TaskType } from "./providers/types";
import type { ResearchConfidence, ResearchScoreBreakdown } from "../types";
import type { EmployeeId } from "../boss-language";

/**
 * The Model Router: Digital Employee → Task Type → Router → Provider →
 * Model. This is the ONLY place the rest of the application should reach
 * to run an AI task — research-actions.ts / content-actions.ts must not
 * call a provider SDK or research-agent.ts/content-agent.ts directly.
 * See docs/model-router.md.
 */

export function isDevelopmentMode(): boolean {
  return process.env.AI_DEVELOPMENT_MODE === "true";
}

/** A task couldn't even be routed to a model — no provider was ever contacted. */
export interface RouterResolutionFailure {
  ok: false;
  data: null;
  error: string;
  provider: null;
  modelId: null;
  inputTokens: null;
  outputTokens: null;
  latencyMs: number;
}

export type RouterResult<T> = AIExecutionResult<T> | RouterResolutionFailure;

export function isRouterResolutionFailure<T>(result: RouterResult<T>): result is RouterResolutionFailure {
  return result.provider === null;
}

async function resolveModelForTask(taskType: TaskType, executionOverride: ModelRef | null | undefined) {
  const config = await getModelRoutingConfig();
  return selectModel({
    taskType,
    developmentMode: isDevelopmentMode(),
    configuredDefault: config[taskType] ?? null,
    executionOverride: executionOverride ?? null,
  });
}

function resolutionFailure(error: string, startedAt: number): RouterResolutionFailure {
  return {
    ok: false,
    data: null,
    error,
    provider: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: Date.now() - startedAt,
  };
}

/** What actually happened on the search side of a Research execution — bubbled up so research-actions.ts can write search_usage_log. Null when no external search step ran at all (native-grounding path). */
export interface SearchUsageMeta {
  provider: SearchProviderId;
  queryCount: number;
  resultCount: number;
  latencyMs: number;
  success: boolean;
  error: string | null;
}

export interface ResearchTaskOutcome {
  result: RouterResult<GroundedResearchPack>;
  searchMeta: SearchUsageMeta | null;
}

async function dispatchStructuredAnyProvider<T>(
  provider: ModelRef["provider"],
  modelId: string,
  params: { systemPrompt: string; userMessage: string; schema: import("zod").ZodType<T>; maxTokens: number },
): Promise<AIExecutionResult<T>> {
  if (provider === "ANTHROPIC") return generateAnthropicStructured({ ...params, modelId });
  if (provider === "GOOGLE") return generateGoogleStructured({ ...params, modelId });
  if (provider === "GROQ") return generateGroqStructured({ ...params, modelId });
  if (provider === "OPENAI") {
    return generateOpenAIStructured({ ...params, modelId, reasoningEffort: getModel(provider, modelId)?.reasoningEffort });
  }
  return generateOpenRouterStructured({ ...params, modelId });
}

async function runNativeResearchTask(
  topic: { title: string; question: string; business: string; audience: string },
  executionOverride: ModelRef | null | undefined,
  started: number,
): Promise<RouterResult<GroundedResearchPack>> {
  const resolution = await resolveModelForTask("RESEARCH", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const customInstructions = await getEmployeeInstruction("researcher");
  if (model.provider === "ANTHROPIC") return runAnthropicResearch(topic, customInstructions, model.modelId);
  if (model.provider === "GOOGLE") return runGoogleResearch(topic, model.modelId, customInstructions);

  // Registry-level capability filtering should make this unreachable —
  // defensive guard, not a silent fallback.
  return resolutionFailure("此模型不支持当前研究流程所需的联网能力。", started);
}

/**
 * Round 4C — Research Query Planner. A narrow, separate AI call
 * (RESEARCH_QUERY_PLANNING, resolved through the Model Router exactly
 * like any other task — never a hard-coded provider/model) that only
 * rewrites the topic into English retrieval queries; see
 * research-query-planner.ts. This is quality enrichment, not a
 * search-availability gate: any failure — no model resolved, the
 * generation call itself failing, or malformed/schema-invalid output
 * (dispatchStructuredAnyProvider already validates against
 * ResearchQueryPlanSchema before returning ok:true) — falls back to
 * Round 4B's deterministic buildResearchSearchQueries(topic), never to a
 * failed Research task. The planner never uses buildSkillPrompt/B's
 * RESEARCHER_SKILL — it's infrastructure, not the digital-employee-facing
 * Skill.
 */
async function resolveResearchSearchQueries(topic: {
  title: string;
  question: string;
  business: string;
  audience: string;
}) {
  // Don't spend a planner call on queries nothing will use — if no search
  // provider is even going to run (native-grounding fallback territory,
  // e.g. no TAVILY_API_KEY configured), the deterministic queries are
  // just as unused as AI-planned ones would be, and the fallback path
  // doesn't touch researchQueries at all.
  const searchResolution = resolveSearchProvider();
  const searchAvailable = searchResolution.ok && isSearchProviderConfigured(searchResolution.provider.provider);
  if (!searchAvailable) {
    return buildResearchSearchQueries(topic);
  }

  const plannerResolution = await resolveModelForTask("RESEARCH_QUERY_PLANNING", null);
  if (!plannerResolution.ok) {
    console.info(`[research] query planning fallback used (no model resolved): ${plannerResolution.error}`);
    return buildResearchSearchQueries(topic);
  }

  const { model } = plannerResolution;
  const planResult = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT,
    userMessage: buildResearchQueryPlannerUserPrompt(topic),
    schema: ResearchQueryPlanSchema,
    maxTokens: 500,
  });

  if (!planResult.ok || !planResult.data) {
    console.info(`[research] query planning fallback used (generation failed): ${planResult.error}`);
    return buildResearchSearchQueries(topic);
  }

  return planToResearchSearchQueries(planResult.data);
}

/**
 * Research Task → Query Planner (Round 4C) → Search Router → Retrieved
 * Sources → Model Router → AI Model → Research Pack. This is the new
 * default path: Brave (or whatever Search Router resolves) retrieves real
 * sources first, then the resolved AI model analyses them via structured
 * generation — it does NOT run its own native web-search tool for this
 * path (see research-external.ts).
 *
 * If no search provider is configured at all, this falls through to the
 * original native-grounding path (runAnthropicResearch /
 * runGoogleResearch, unchanged) — a reasonable zero-config default, not a
 * paid fallback, since both paths stay within the free tier. If a search
 * provider IS configured but fails (rate limited, quota, network) there is
 * NO fallback — the failure is returned as-is, so ADMIN sees exactly what
 * broke instead of an unexplained silent strategy switch. See
 * docs/search-router.md.
 */
export async function runResearchTask(
  topic: { title: string; question: string; business: string; audience: string },
  executionOverride?: ModelRef | null,
): Promise<ResearchTaskOutcome> {
  const started = Date.now();
  const researchQueries = await resolveResearchSearchQueries(topic);
  const searchOutcome = await runResearchSearch(researchQueries);

  if (!searchOutcome.ok) {
    // "Never actually reached a provider" (not configured, or no FREE
    // provider is available at all — e.g. Brave now requires a paid plan
    // with no free tier) falls through to the still-free native-grounding
    // path, same as before. A provider that WAS reached and then failed
    // (rate limited, network error) does NOT fall back — see
    // docs/search-router.md.
    if (searchOutcome.errorCode === "SEARCH_PROVIDER_NOT_CONFIGURED" || searchOutcome.errorCode === "SEARCH_ROUTER_UNRESOLVED") {
      return { result: await runNativeResearchTask(topic, executionOverride, started), searchMeta: null };
    }
    return {
      result: resolutionFailure(searchOutcome.error, started),
      searchMeta: {
        provider: "BRAVE",
        queryCount: researchQueries.length,
        resultCount: 0,
        latencyMs: Date.now() - started,
        success: false,
        error: searchOutcome.error,
      },
    };
  }

  // Tag each raw result with which lane (OFFICIAL_PRIMARY/OFFICIAL_LEGAL/
  // GENERAL) produced it and its rank within that query's own results
  // (Round 4D) — used only for extraction-target selection below, before
  // any cross-query dedup/ranking collapses that per-query identity.
  const laneHits = tagSearchHitsByLane(searchOutcome.executions, researchQueries);

  // De-duplicate before ranking (Round 4B) — the official-only and
  // guidance-only queries can both legitimately return the same official
  // page; it must enter the evidence manifest exactly once. This is the
  // EVIDENCE view (everything Sol sees as SEARCH_SNIPPET/OFFICIAL_EXTRACT)
  // — separate from extraction-target selection, which uses laneHits above.
  const allResults = rankSearchResults(dedupeSearchResultsByUrl(searchOutcome.executions.flatMap((e) => e.results)));
  const searchLatencyMs = searchOutcome.executions.reduce((sum, e) => sum + e.latencyMs, 0);
  const searchMeta: SearchUsageMeta = {
    provider: searchOutcome.provider,
    queryCount: researchQueries.length,
    resultCount: allResults.length,
    latencyMs: searchLatencyMs,
    success: true,
    error: null,
  };

  const modelResolution = await resolveModelForTask("RESEARCH", executionOverride);
  if (!modelResolution.ok) {
    return { result: resolutionFailure(modelResolution.error, started), searchMeta };
  }

  // Official source enrichment (Round 4A, lane-aware selection since
  // Round 4D): read real page content for a few extraction-worthy
  // primary-source URLs before handing evidence to Sol — see
  // docs/search-router.md "Official source extraction" and "Query-aware
  // official extraction selection". Extraction is quality enrichment, not
  // a search-availability gate: a failure here never fails the whole
  // Research task, it just leaves that source as a SEARCH_SNIPPET
  // (extractOfficialSources itself never throws).
  const officialCandidates = selectOfficialExtractionTargets(laneHits, MAX_OFFICIAL_EXTRACTS);
  const extractionOutcome = officialCandidates.length
    ? await extractOfficialSources(
        officialCandidates.map((r) => r.url),
        buildExtractionQuery(topic),
      )
    : { extracted: [], failed: [], latencyMs: 0 };
  const extractedByUrl = new Map(extractionOutcome.extracted.map((e) => [e.url, e.content]));
  if (officialCandidates.length > 0) {
    console.info(
      `[research] official extraction: attempted=${officialCandidates.length} succeeded=${extractedByUrl.size} failed=${extractionOutcome.failed.length} latencyMs=${extractionOutcome.latencyMs}`,
    );
  }

  const { labelToResult, manifestText } = buildSearchResultManifest(allResults, extractedByUrl);
  const userMessage = buildExternalResearchUserPrompt(
    topic,
    researchQueries.map((q) => q.query),
    manifestText,
  );
  const { model } = modelResolution;
  const customInstructions = await getEmployeeInstruction("researcher");

  const genResult = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("researcher", EXTERNAL_RESEARCH_SYSTEM_PROMPT), customInstructions),
    userMessage,
    schema: ExternalResearchClaimSchema,
    maxTokens: 8000,
  });

  if (!genResult.ok || !genResult.data) {
    return { result: { ...genResult, data: null }, searchMeta };
  }

  return {
    result: {
      ...genResult,
      data: buildExternalGroundedPack(genResult.data, labelToResult, {
        officialExtractCount: extractedByUrl.size,
        failedExtractionCount: extractionOutcome.failed.length,
      }),
    },
    searchMeta,
  };
}

/** Usage stats for the SEPARATE, independent audit call (see runResearchOptimizationTask) — null whenever the audit never ran (the content call itself failed or was never dispatched). research-actions.ts logs this as its own ai_usage_log row, since it's a genuinely separate model call from the content call `result` reflects. */
export interface ResearchAuditUsage {
  provider: AIProviderId;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
}

/**
 * Which category a failed optimization attempt falls into — lets
 * research-actions.ts pick the right user-facing message without sniffing
 * error text (fragile) or collapsing every failure into "search
 * unavailable" (misleading — an audit-call schema error has nothing to do
 * with search). Only meaningful when `result.ok` is false.
 */
export type ResearchOptimizationFailureReason = "SEARCH_UNAVAILABLE" | "AI_FAILURE";

export interface ResearchOptimizationTaskOutcome {
  result: RouterResult<OptimizedResearchPack>;
  searchMeta: SearchUsageMeta | null;
  auditUsage: ResearchAuditUsage | null;
  failureReason?: ResearchOptimizationFailureReason;
}

/**
 * B｜政策研究员's "研究优化" mode (see docs/ai-workflows.md "研究优化") —
 * NOT a parallel research system: reuses the exact same Search Router →
 * lane tagging → official extraction → Model Router pipeline runResearchTask
 * uses, just with two differences: the search queries are generated from
 * the PREVIOUS pack's low-scoring dimensions (buildOptimizationSearchQueries)
 * instead of the fixed 3-query cold-start template, and the model is shown
 * the previous round's full result (not just told to start fresh) via
 * RESEARCH_OPTIMIZATION_SYSTEM_PROMPT / buildResearchOptimizationUserPrompt.
 *
 * Deliberately has no native-grounding fallback (unlike runResearchTask) —
 * optimization's entire value proposition is targeted NEW evidence aimed at
 * a specific gap; without a configured search provider there is nothing
 * genuinely new to target the gap with, and falling back to the native
 * Anthropic/Google web-search agent would silently re-run a completely
 * different, un-targeted research process under the "optimization" label.
 * research-actions.ts surfaces this as a clear, honest error instead.
 */
export async function runResearchOptimizationTask(
  topic: { title: string; question: string; business: string; audience: string },
  previousPack: {
    summary: string;
    keyFindings: readonly string[];
    warnings: string;
    confidence: ResearchConfidence;
    scoreBreakdown: ResearchScoreBreakdown;
  },
  executionOverride?: ModelRef | null,
): Promise<ResearchOptimizationTaskOutcome> {
  const started = Date.now();
  const searchResolution = resolveSearchProvider();
  if (!searchResolution.ok || !isSearchProviderConfigured(searchResolution.provider.provider)) {
    return {
      result: resolutionFailure("优化研究需要联网搜索能力，当前未配置搜索服务提供商，无法针对性补充证据。", started),
      searchMeta: null,
      auditUsage: null,
      failureReason: "SEARCH_UNAVAILABLE",
    };
  }

  // Optimization needs the same English official/legal terminology as an
  // initial research run. Using the raw Chinese question here previously
  // produced six mixed-language queries and ranked unrelated official pages
  // (while the initial path correctly found Returning Resident guidance).
  const plannedQueries = await resolveResearchSearchQueries(topic);
  const researchQueries = buildOptimizationSearchQueries(topic, previousPack.scoreBreakdown, plannedQueries);
  const searchOutcome = await runResearchSearch(researchQueries);

  if (!searchOutcome.ok) {
    return {
      result: resolutionFailure(searchOutcome.error, started),
      searchMeta: {
        provider: "TAVILY",
        queryCount: researchQueries.length,
        resultCount: 0,
        latencyMs: Date.now() - started,
        success: false,
        error: searchOutcome.error,
      },
      auditUsage: null,
      failureReason: "SEARCH_UNAVAILABLE",
    };
  }

  const laneHits = tagSearchHitsByLane(searchOutcome.executions, researchQueries);
  const allResults = rankSearchResults(dedupeSearchResultsByUrl(searchOutcome.executions.flatMap((e) => e.results)));
  const searchLatencyMs = searchOutcome.executions.reduce((sum, e) => sum + e.latencyMs, 0);
  const searchMeta: SearchUsageMeta = {
    provider: searchOutcome.provider,
    queryCount: researchQueries.length,
    resultCount: allResults.length,
    latencyMs: searchLatencyMs,
    success: true,
    error: null,
  };

  const contentModelResolution = await resolveModelForTask("RESEARCH", executionOverride);
  if (!contentModelResolution.ok) {
    return {
      result: resolutionFailure(contentModelResolution.error, started),
      searchMeta,
      auditUsage: null,
      failureReason: "AI_FAILURE",
    };
  }

  const officialCandidates = selectOfficialExtractionTargets(laneHits, MAX_OFFICIAL_EXTRACTS);
  const extractionOutcome = officialCandidates.length
    ? await extractOfficialSources(
        officialCandidates.map((r) => r.url),
        buildExtractionQuery(topic),
      )
    : { extracted: [], failed: [], latencyMs: 0 };
  const extractedByUrl = new Map(extractionOutcome.extracted.map((e) => [e.url, e.content]));

  const { labelToResult, manifestText } = buildSearchResultManifest(allResults, extractedByUrl);
  const contentUserMessage = buildResearchOptimizationUserPrompt(
    topic,
    previousPack,
    researchQueries.map((q) => q.query),
    manifestText,
  );
  const { model: contentModel } = contentModelResolution;
  const customInstructions = await getEmployeeInstruction("researcher");

  const contentResult = await dispatchStructuredAnyProvider(contentModel.provider, contentModel.modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("researcher", RESEARCH_OPTIMIZATION_SYSTEM_PROMPT), customInstructions),
    userMessage: contentUserMessage,
    schema: ResearchOptimizationContentClaimSchema,
    maxTokens: 8000,
  });

  if (!contentResult.ok || !contentResult.data) {
    return { result: { ...contentResult, data: null }, searchMeta, auditUsage: null, failureReason: "AI_FAILURE" };
  }

  const retrievalMeta = { officialExtractCount: extractedByUrl.size, failedExtractionCount: extractionOutcome.failed.length };
  const optimizedContent = buildOptimizedContent(contentResult.data, labelToResult, retrievalMeta);

  // Independent audit — resolved separately from CONTENT above (its own
  // Model Router entry, RESEARCH_AUDIT), so it can land on a different
  // provider and never shares the content call's context.
  const auditModelResolution = await resolveModelForTask("RESEARCH_AUDIT", null);
  if (!auditModelResolution.ok) {
    return {
      result: resolutionFailure(`研究内容已生成，但无法进行独立复核评分：${auditModelResolution.error}`, started),
      searchMeta,
      auditUsage: null,
      failureReason: "AI_FAILURE",
    };
  }

  const { model: auditModel } = auditModelResolution;
  const auditUserMessage = buildResearchAuditUserPrompt(topic, optimizedContent, manifestText);
  const auditResult = await dispatchStructuredAnyProvider(auditModel.provider, auditModel.modelId, {
    systemPrompt: buildSkillPrompt("researcher", RESEARCH_AUDIT_SYSTEM_PROMPT),
    userMessage: auditUserMessage,
    schema: ResearchAuditClaimSchema,
    // Claude's structured-output reasoning shares this budget with the
    // final JSON. 2,000 repeatedly ended with stop_reason=max_tokens before
    // the six score objects were emitted, discarding otherwise successful
    // optimization content. Keep parity with the content pass.
    maxTokens: 8000,
  });

  const auditUsage: ResearchAuditUsage = {
    provider: auditResult.provider,
    modelId: auditResult.modelId,
    inputTokens: auditResult.inputTokens,
    outputTokens: auditResult.outputTokens,
    latencyMs: auditResult.latencyMs,
    ok: auditResult.ok,
    error: auditResult.error,
  };

  if (!auditResult.ok || !auditResult.data) {
    return {
      result: { ...contentResult, ok: false, data: null, error: `研究内容已生成，但独立复核评分失败：${auditResult.error}` },
      searchMeta,
      auditUsage,
      failureReason: "AI_FAILURE",
    };
  }

  return {
    result: { ...contentResult, data: combineAuditedOptimizationPack(optimizedContent, auditResult.data) },
    searchMeta,
    auditUsage,
  };
}

async function dispatchStructured<T>(
  provider: Exclude<ModelRef["provider"], "ANTHROPIC">,
  modelId: string,
  params: { systemPrompt: string; userMessage: string; schema: import("zod").ZodType<T>; maxTokens: number },
): Promise<AIExecutionResult<T>> {
  if (provider === "GOOGLE") return generateGoogleStructured({ ...params, modelId });
  if (provider === "GROQ") return generateGroqStructured({ ...params, modelId });
  if (provider === "OPENAI") {
    return generateOpenAIStructured({ ...params, modelId, reasoningEffort: getModel(provider, modelId)?.reasoningEffort });
  }
  return generateOpenRouterStructured({ ...params, modelId });
}

/** Shared non-Anthropic path for one content task: build the prompt from CONTENT_TASK_CONFIG, dispatch, then apply the same grounding/safety net the Anthropic path applies inline. Kept generic here (not exported) — every call site below supplies a concrete T so inference stays sound. */
async function runGenericContentTask<T extends Groundable>(
  provider: Exclude<ModelRef["provider"], "ANTHROPIC">,
  modelId: string,
  input: EvidenceInput,
  config: {
    systemPrompt: string;
    taskInstruction: string;
    schema: import("zod").ZodType<T>;
    maxTokens: number;
    textFieldsForScan: (parsed: T) => string[];
  },
  employeeId: EmployeeId,
  customInstructions?: string | null,
): Promise<AIExecutionResult<T>> {
  const { labelToId, manifestText } = buildSourceManifest(input.sources);
  const context = buildEvidenceContextBlock(
    input.topic,
    input.researchPack,
    manifestText,
    input.xiaohongshuPostContext,
  );
  const userMessage = `${context}\n\n${config.taskInstruction}`;

  const result = await dispatchStructured(provider, modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt(employeeId, config.systemPrompt), customInstructions),
    userMessage,
    schema: config.schema,
    maxTokens: config.maxTokens,
  });
  if (!result.ok || !result.data) return result;

  return { ...result, data: applyGroundingAndSafety(result.data, labelToId, config.textFieldsForScan) };
}

export async function runContentTask(
  taskType: GenericContentTaskType,
  input: EvidenceInput,
  executionOverride?: ModelRef | null,
): Promise<
  RouterResult<VideoChannelContent | XiaohongshuContent | XiaohongshuPagesPlan | WechatOutline | WechatArticle>
> {
  const started = Date.now();
  const resolution = await resolveModelForTask(taskType, executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const employeeId = TASK_TYPE_EMPLOYEE[taskType];
  const customInstructions = await getEmployeeInstruction(employeeId);
  if (model.provider === "ANTHROPIC") return runAnthropicContentTask(taskType, input, customInstructions, model.modelId);
  const provider = model.provider;

  if (taskType === "VIDEO_WRITING") {
    return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.VIDEO_WRITING, employeeId, customInstructions);
  }
  if (taskType === "XIAOHONGSHU_WRITING") {
    return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.XIAOHONGSHU_WRITING, employeeId, customInstructions);
  }
  if (taskType === "XIAOHONGSHU_PAGES_PLANNING") {
    return runGenericContentTask(
      provider,
      model.modelId,
      input,
      CONTENT_TASK_CONFIG.XIAOHONGSHU_PAGES_PLANNING,
      employeeId,
      customInstructions,
    );
  }
  if (taskType === "WECHAT_ARTICLE_WRITING") {
    return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.WECHAT_ARTICLE_WRITING, employeeId, customInstructions);
  }
  return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.WECHAT_WRITING, employeeId, customInstructions);
}

/**
 * Employee H（终审修改员）— takes a draft plus the specific compliance
 * findings a human is looking at (see docs), and produces a revised
 * version that fixes ONLY those findings. Always routed generically (even
 * for ANTHROPIC) via dispatchStructuredAnyProvider, same as
 * runComplianceTask/runTopicDiscoveryTask — there's no Anthropic-specific
 * content-agent.ts path for this task. The caller (revision-actions.ts)
 * saves the result as a new content_assets version, exactly like any
 * other regeneration.
 */
export interface RevisionInput extends EvidenceInput {
  existingContentText: string;
  findings: Array<{ issue_type: string; quote: string; explanation: string }>;
}

async function runOneRevisionTask<T extends Groundable>(
  provider: ModelRef["provider"],
  modelId: string,
  input: RevisionInput,
  config: {
    systemPrompt: string;
    taskInstruction: string;
    schema: import("zod").ZodType<T>;
    maxTokens: number;
    textFieldsForScan: (parsed: T) => string[];
  },
  customInstructions: string | null,
): Promise<AIExecutionResult<T>> {
  const { labelToId, manifestText } = buildSourceManifest(input.sources);
  const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
  const revisionContext = buildRevisionContextBlock(input.existingContentText, input.findings);
  const userMessage = `${context}\n\n${revisionContext}\n\n${config.taskInstruction}`;

  const result = await dispatchStructuredAnyProvider(provider, modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("reviser", config.systemPrompt), customInstructions),
    userMessage,
    schema: config.schema,
    maxTokens: config.maxTokens,
  });
  if (!result.ok || !result.data) return result;

  return { ...result, data: applyGroundingAndSafety(result.data, labelToId, config.textFieldsForScan) };
}

export async function runContentRevisionTask(
  taskType: RevisionTaskType,
  input: RevisionInput,
  executionOverride?: ModelRef | null,
): Promise<RouterResult<VideoChannelContent | XiaohongshuContent | XiaohongshuPagesPlan | WechatArticle>> {
  const started = Date.now();
  const resolution = await resolveModelForTask(taskType, executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const customInstructions = await getEmployeeInstruction("reviser");

  if (taskType === "VIDEO_REVISION") {
    return runOneRevisionTask(model.provider, model.modelId, input, REVISION_TASK_CONFIG.VIDEO_REVISION, customInstructions);
  }
  if (taskType === "XIAOHONGSHU_REVISION") {
    return runOneRevisionTask(model.provider, model.modelId, input, REVISION_TASK_CONFIG.XIAOHONGSHU_REVISION, customInstructions);
  }
  if (taskType === "XIAOHONGSHU_PAGES_REVISION") {
    return runOneRevisionTask(
      model.provider,
      model.modelId,
      input,
      REVISION_TASK_CONFIG.XIAOHONGSHU_PAGES_REVISION,
      customInstructions,
    );
  }
  return runOneRevisionTask(model.provider, model.modelId, input, REVISION_TASK_CONFIG.WECHAT_ARTICLE_REVISION, customInstructions);
}

export async function runWechatFullArticleTask(
  input: EvidenceInput & {
    outline: Pick<WechatOutline, "title_options" | "summary" | "detailed_outline" | "key_claims">;
  },
  executionOverride?: ModelRef | null,
): Promise<RouterResult<WechatFullArticle>> {
  const started = Date.now();
  const resolution = await resolveModelForTask("WECHAT_FULL_ARTICLE", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const customInstructions = await getEmployeeInstruction("wechat-editor");
  if (model.provider === "ANTHROPIC") return runAnthropicWechatFullArticle(input, customInstructions, model.modelId);

  const { labelToId, manifestText } = buildSourceManifest(input.sources);
  const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
  const outlineContext = buildOutlineContextBlock(input.outline);
  const userMessage = `${context}\n\n${outlineContext}\n\nWrite the full WeChat Official Account article now, following the outline and rules above.`;

  const result = await dispatchStructured(model.provider, model.modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("wechat-editor", WECHAT_FULL_ARTICLE_SYSTEM_PROMPT), customInstructions),
    userMessage,
    schema: WechatFullArticleSchema,
    maxTokens: 16000,
  });
  if (!result.ok || !result.data) return result;

  return {
    ...result,
    data: applyGroundingAndSafety(result.data, labelToId, (c) => [c.title, c.full_article]),
  };
}

/**
 * Employee D (合规审核员) — re-checks already-generated content against the
 * SAME approved Research Pack it was written from, plus a deterministic
 * forbidden-phrase scan (mergeComplianceFindings), regardless of what the
 * model itself reports. Never returns a "compliant/approved" verdict —
 * only findings for a human. See compliance-schemas.ts.
 */
export async function runComplianceTask(
  content: { platform: string; textForReview: string },
  researchPack: { summary: string; key_findings: string[]; warnings: string; confidence: ResearchConfidence },
  executionOverride?: ModelRef | null,
): Promise<RouterResult<ComplianceReview>> {
  const started = Date.now();
  const resolution = await resolveModelForTask("COMPLIANCE", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const userMessage = buildComplianceContextBlock(content, researchPack);
  const customInstructions = await getEmployeeInstruction("compliance");

  const result = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("compliance", COMPLIANCE_SYSTEM_PROMPT), customInstructions),
    userMessage,
    schema: ComplianceReviewSchema,
    maxTokens: 4000,
  });
  if (!result.ok || !result.data) return result;

  const scanned = scanTextForComplianceFindings(content.textForReview);
  const findings = mergeComplianceFindings(result.data.findings, scanned);
  const overall_risk = overallRiskFor(findings, result.data.overall_risk);

  return { ...result, data: { ...result.data, findings, overall_risk } };
}

/**
 * Employee A's "今日选题搜索" — Search Router (real news search) → Model
 * Router → candidate topics. Mirrors runResearchTask's shape but simpler:
 * no native-grounding fallback (this feature has no "always worked before
 * Search Router existed" native path to fall back to), and candidates are
 * advisory only — nothing is written to the topics table here. If the
 * search step fails outright, returns an empty result with the error
 * surfaced to the caller rather than guessing at topics with no evidence.
 */
export async function runTopicDiscoveryTask(
  keyword?: string,
  executionOverride?: ModelRef | null,
): Promise<RouterResult<TopicDiscoveryResult>> {
  const started = Date.now();
  const queries = buildDiscoveryQueries(new Date(), keyword);
  const searchOutcome = await runResearchSearch(queries);

  if (!searchOutcome.ok) {
    return resolutionFailure(searchOutcome.error, started);
  }

  // Round 3C: round-robin pooled across all 5 AUTO-discovery editorial
  // lanes (directed search's single execution is unaffected), deduped by
  // normalized URL — see poolDiscoveryResults in topic-discovery.ts.
  const allResults = poolDiscoveryResults(searchOutcome.executions);
  const labeled = allResults.map((r, i) => ({
    label: `N${i + 1}`,
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    publishedDate: r.publishedDate,
  }));
  const manifestText = buildDiscoveryManifest(labeled);

  const modelResolution = await resolveModelForTask("TOPIC_DISCOVERY", executionOverride);
  if (!modelResolution.ok) return resolutionFailure(modelResolution.error, started);

  // Round 3D: AUTO and DIRECTED use different structured-output schemas —
  // this is what actually forces AUTO to return 5-6 candidates when
  // evidence supports it, instead of relying on prompt wording alone
  // (which a real production run showed the model happily undershooting).
  // Directed search keeps its existing 0-3, never-forced schema
  // unconditionally. See docs/search-router.md-style rationale in
  // topic-discovery.ts's schema comments.
  const trimmedKeyword = keyword?.trim();
  const isSparse = !trimmedKeyword && !hasSufficientAutoEvidence(allResults.length, searchOutcome.executions.map((e) => e.results.length));
  const schema = trimmedKeyword
    ? DirectedTopicDiscoveryResultSchema
    : isSparse
      ? AutoSparseTopicDiscoveryResultSchema
      : AutoTopicDiscoveryResultSchema;

  const { model } = modelResolution;
  const customInstructions = await getEmployeeInstruction("planner");
  const genResult = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("planner", TOPIC_DISCOVERY_SYSTEM_PROMPT), customInstructions),
    userMessage: buildTopicDiscoveryUserPrompt(manifestText, keyword, { sparse: isSparse }),
    schema,
    maxTokens: 4000,
  });

  if (!genResult.ok || !genResult.data) return genResult;

  // Defensive re-validation (Round 3A) — drop any candidate whose
  // source_label isn't one of this search's real labels, rather than
  // trusting the prompt alone or failing the whole task over one bad label.
  const validLabels = labeled.map((l) => l.label);
  return {
    ...genResult,
    data: { candidates: filterCandidatesByValidLabels(genResult.data.candidates, validLabels) },
  };
}

/**
 * Employee 图片设计员 — generates a cover image from an already
 * human-reviewed 小红书 post draft (never from raw research directly).
 * Only OPENAI currently registers a supportsImageGeneration model — the
 * registry filter makes any other resolution unreachable, but this stays a
 * defensive guard rather than a silent fallback, matching every other task
 * dispatcher in this file.
 */
export async function runImageGenerationTask(
  prompt: string,
  executionOverride?: ModelRef | null,
  referenceImages?: { bytes: Buffer; mimeType: string; filename: string }[],
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1536",
): Promise<RouterResult<{ images: string[] }>> {
  const started = Date.now();
  const resolution = await resolveModelForTask("IMAGE_GENERATION", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  if (model.provider !== "OPENAI") {
    return resolutionFailure("此模型不支持图片生成。", started);
  }
  if (referenceImages && referenceImages.length > 0) {
    return generateOpenAIImageEdit({ prompt, modelId: model.modelId, size, referenceImages });
  }
  return generateOpenAIImage({ prompt, modelId: model.modelId, size });
}

export { resolveModelForTask };
