import "server-only";
import { selectModel } from "./model-selection";
import { getModelRoutingConfig } from "./model-config";
import {
  runAnthropicResearch,
  runAnthropicContentTask,
  runAnthropicWechatFullArticle,
  generateAnthropicStructured,
  generateAnthropicStructuredFromImage,
} from "./providers/anthropic-provider";
import { runGoogleResearch, generateGoogleStructured, generateGoogleStructuredFromImage } from "./providers/google-provider";
import { generateGroqStructured } from "./providers/groq-provider";
import { generateOpenRouterStructured } from "./providers/openrouter-provider";
import { generateOpenAIStructured, generateOpenAIImage } from "./providers/openai-provider";
import { buildSourceManifest, buildEvidenceContextBlock, buildOutlineContextBlock } from "./content-schemas";
import { applyGroundingAndSafety, CONTENT_TASK_CONFIG, WECHAT_FULL_ARTICLE_SYSTEM_PROMPT, WechatFullArticleSchema } from "./content-schemas";
import { runResearchSearch } from "../search/router";
import { buildResearchQueries, rankSearchResults } from "./research-queries";
import {
  EXTERNAL_RESEARCH_SYSTEM_PROMPT,
  ExternalResearchClaimSchema,
  buildExternalGroundedPack,
  buildExternalResearchUserPrompt,
  buildSearchResultManifest,
} from "./research-external";
import type { EvidenceInput } from "./content-agent";
import type { GroundedResearchPack } from "./research-pack";
import type {
  VideoChannelContent,
  XiaohongshuContent,
  WechatOutline,
  WechatFullArticle,
  GenericContentTaskType,
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
  TopicDiscoveryResultSchema,
  buildDiscoveryManifest,
  buildDiscoveryQueries,
  buildTopicDiscoveryUserPrompt,
} from "./topic-discovery";
import type { TopicDiscoveryResult } from "./topic-discovery";
import {
  PERFORMANCE_EXTRACTION_SYSTEM_PROMPT,
  PerformanceMetricsSchema,
  buildPerformanceExtractionUserPrompt,
} from "./performance-schemas";
import type { PerformanceMetrics } from "./performance-schemas";
import type { SearchProviderId } from "../search/types";
import type { AIExecutionResult, ModelRef, TaskType } from "./providers/types";
import type { ResearchConfidence } from "../types";

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
  if (provider === "OPENAI") return generateOpenAIStructured({ ...params, modelId });
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
  if (model.provider === "ANTHROPIC") return runAnthropicResearch(topic);
  if (model.provider === "GOOGLE") return runGoogleResearch(topic, model.modelId);

  // Registry-level capability filtering should make this unreachable —
  // defensive guard, not a silent fallback.
  return resolutionFailure("此模型不支持当前研究流程所需的联网能力。", started);
}

/**
 * Research Task → Search Router → Retrieved Sources → Model Router → AI
 * Model → Research Pack. This is the new default path: Brave (or whatever
 * Search Router resolves) retrieves real sources first, then the resolved
 * AI model analyses them via structured generation — it does NOT run its
 * own native web-search tool for this path (see research-external.ts).
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
  const queries = buildResearchQueries(topic);
  const searchOutcome = await runResearchSearch(queries);

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
        queryCount: queries.length,
        resultCount: 0,
        latencyMs: Date.now() - started,
        success: false,
        error: searchOutcome.error,
      },
    };
  }

  const allResults = rankSearchResults(searchOutcome.executions.flatMap((e) => e.results));
  const searchLatencyMs = searchOutcome.executions.reduce((sum, e) => sum + e.latencyMs, 0);
  const searchMeta: SearchUsageMeta = {
    provider: searchOutcome.provider,
    queryCount: queries.length,
    resultCount: allResults.length,
    latencyMs: searchLatencyMs,
    success: true,
    error: null,
  };

  const modelResolution = await resolveModelForTask("RESEARCH", executionOverride);
  if (!modelResolution.ok) {
    return { result: resolutionFailure(modelResolution.error, started), searchMeta };
  }

  const { labelToResult, manifestText } = buildSearchResultManifest(allResults);
  const userMessage = buildExternalResearchUserPrompt(topic, queries, manifestText);
  const { model } = modelResolution;

  const genResult = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: EXTERNAL_RESEARCH_SYSTEM_PROMPT,
    userMessage,
    schema: ExternalResearchClaimSchema,
    maxTokens: 8000,
  });

  if (!genResult.ok || !genResult.data) {
    return { result: { ...genResult, data: null }, searchMeta };
  }

  return {
    result: { ...genResult, data: buildExternalGroundedPack(genResult.data, labelToResult) },
    searchMeta,
  };
}

async function dispatchStructured<T>(
  provider: Exclude<ModelRef["provider"], "ANTHROPIC">,
  modelId: string,
  params: { systemPrompt: string; userMessage: string; schema: import("zod").ZodType<T>; maxTokens: number },
): Promise<AIExecutionResult<T>> {
  if (provider === "GOOGLE") return generateGoogleStructured({ ...params, modelId });
  if (provider === "GROQ") return generateGroqStructured({ ...params, modelId });
  if (provider === "OPENAI") return generateOpenAIStructured({ ...params, modelId });
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
): Promise<AIExecutionResult<T>> {
  const { labelToId, manifestText } = buildSourceManifest(input.sources);
  const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
  const userMessage = `${context}\n\n${config.taskInstruction}`;

  const result = await dispatchStructured(provider, modelId, {
    systemPrompt: config.systemPrompt,
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
): Promise<RouterResult<VideoChannelContent | XiaohongshuContent | WechatOutline>> {
  const started = Date.now();
  const resolution = await resolveModelForTask(taskType, executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  if (model.provider === "ANTHROPIC") return runAnthropicContentTask(taskType, input);
  const provider = model.provider;

  if (taskType === "VIDEO_WRITING") {
    return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.VIDEO_WRITING);
  }
  if (taskType === "XIAOHONGSHU_WRITING") {
    return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.XIAOHONGSHU_WRITING);
  }
  return runGenericContentTask(provider, model.modelId, input, CONTENT_TASK_CONFIG.WECHAT_WRITING);
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
  if (model.provider === "ANTHROPIC") return runAnthropicWechatFullArticle(input);

  const { labelToId, manifestText } = buildSourceManifest(input.sources);
  const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
  const outlineContext = buildOutlineContextBlock(input.outline);
  const userMessage = `${context}\n\n${outlineContext}\n\nWrite the full WeChat Official Account article now, following the outline and rules above.`;

  const result = await dispatchStructured(model.provider, model.modelId, {
    systemPrompt: WECHAT_FULL_ARTICLE_SYSTEM_PROMPT,
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

  const result = await dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
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

  const allResults = searchOutcome.executions.flatMap((e) => e.results);
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

  const { model } = modelResolution;
  return dispatchStructuredAnyProvider(model.provider, model.modelId, {
    systemPrompt: TOPIC_DISCOVERY_SYSTEM_PROMPT,
    userMessage: buildTopicDiscoveryUserPrompt(manifestText),
    schema: TopicDiscoveryResultSchema,
    maxTokens: 4000,
  });
}

/**
 * Employee E (数据分析员) reads the numbers off one post-publish
 * performance screenshot. Only ANTHROPIC/GOOGLE ever resolve here — the
 * registry's supportsVision filter excludes GROQ/OPENROUTER's current
 * text-only free models, so this defensively rejects rather than silently
 * mis-dispatching if that ever changes.
 */
export async function runPerformanceAnalysisTask(
  image: { base64: string; mimeType: "image/png" | "image/jpeg" | "image/webp" },
  platform: string,
  executionOverride?: ModelRef | null,
): Promise<RouterResult<PerformanceMetrics>> {
  const started = Date.now();
  const resolution = await resolveModelForTask("PERFORMANCE_ANALYSIS", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  const params = {
    systemPrompt: PERFORMANCE_EXTRACTION_SYSTEM_PROMPT,
    userMessage: buildPerformanceExtractionUserPrompt(platform),
    schema: PerformanceMetricsSchema,
    maxTokens: 1000,
    modelId: model.modelId,
    imageBase64: image.base64,
    mimeType: image.mimeType,
  };

  if (model.provider === "ANTHROPIC") return generateAnthropicStructuredFromImage(params);
  if (model.provider === "GOOGLE") return generateGoogleStructuredFromImage(params);

  return resolutionFailure("此模型不支持读取截图（缺少视觉能力）。", started);
}

/**
 * Employee 小红书图片设计员 — generates a cover image from an already
 * human-reviewed 小红书 post draft (never from raw research directly).
 * Only OPENAI currently registers a supportsImageGeneration model — the
 * registry filter makes any other resolution unreachable, but this stays a
 * defensive guard rather than a silent fallback, matching every other task
 * dispatcher in this file.
 */
export async function runImageGenerationTask(
  prompt: string,
  executionOverride?: ModelRef | null,
): Promise<RouterResult<{ images: string[] }>> {
  const started = Date.now();
  const resolution = await resolveModelForTask("IMAGE_GENERATION", executionOverride);
  if (!resolution.ok) return resolutionFailure(resolution.error, started);

  const { model } = resolution;
  if (model.provider !== "OPENAI") {
    return resolutionFailure("此模型不支持图片生成。", started);
  }
  return generateOpenAIImage({ prompt, modelId: model.modelId, size: "1024x1536" });
}

export { resolveModelForTask };
