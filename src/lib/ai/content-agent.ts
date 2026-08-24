import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import {
  VIDEO_SYSTEM_PROMPT,
  XHS_SYSTEM_PROMPT,
  WECHAT_OUTLINE_SYSTEM_PROMPT,
  WECHAT_FULL_ARTICLE_SYSTEM_PROMPT,
  VideoChannelContentSchema,
  XiaohongshuContentSchema,
  WechatOutlineSchema,
  WechatFullArticleSchema,
  buildEvidenceContextBlock,
  buildOutlineContextBlock,
  buildSourceManifest,
  groundContentSources,
  buildForbiddenPhraseNotes,
  type VideoChannelContent,
  type XiaohongshuContent,
  type WechatOutline,
  type WechatFullArticle,
  type EvidenceNote,
} from "./content-schemas";
import { appendCustomInstructions } from "./prompt-addendum";
import { buildSkillPrompt } from "./skills";
import type { ResearchPack, ResearchSource, Topic } from "../types";

const MODEL_ALIAS = process.env.CONTENT_MODEL || "claude-opus-5";

function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isContentAgentConfigured(): boolean {
  return isConfigured();
}

export function contentAgentModelAlias(): string {
  return MODEL_ALIAS;
}

export interface ContentAgentSuccess<T> {
  ok: true;
  content: T;
  modelAlias: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface ContentAgentFailure {
  ok: false;
  error: string;
  modelAlias: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export type ContentAgentResult<T> = ContentAgentSuccess<T> | ContentAgentFailure;

export interface EvidenceInput {
  topic: Pick<Topic, "title" | "question" | "business" | "audience" | "content_pillar">;
  researchPack: Pick<ResearchPack, "summary" | "key_findings" | "warnings" | "confidence">;
  sources: ResearchSource[];
}

function formatError(err: unknown): string {
  return err instanceof Anthropic.APIError
    ? `Anthropic API 错误 (${err.status}): ${err.message}`
    : err instanceof Error
      ? err.message
      : "未知错误";
}

async function callStructured<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  maxTokens: number;
}): Promise<{ parsed: T; usage: { input_tokens: number; output_tokens: number } }> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL_ALIAS,
    max_tokens: params.maxTokens,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userMessage }],
    output_config: { format: zodOutputFormat(params.schema) },
  });

  if (!response.parsed_output) {
    throw new Error("模型输出未能解析为预期结构。");
  }

  // Defensive re-validation — output_config.format should already
  // constrain the shape, but this is the explicit "validate all Anthropic
  // output before storing" step, not just trusting the SDK's parse.
  const revalidated = params.schema.safeParse(response.parsed_output);
  if (!revalidated.success) {
    const issues = revalidated.error.issues.map((i) => i.message).join("; ");
    throw new Error(`模型输出未通过结构校验：${issues}`);
  }

  return { parsed: revalidated.data, usage: response.usage };
}

type Groundable = { source_references: string[]; expert_review_notes: EvidenceNote[] };

async function runContentGeneration<T extends Groundable>(
  input: EvidenceInput,
  opts: {
    systemPrompt: string;
    taskInstruction: string;
    schema: ZodType<T>;
    maxTokens: number;
    textFieldsForScan: (parsed: T) => string[];
  },
): Promise<ContentAgentResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY 未配置，无法生成内容。",
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const { labelToId, manifestText } = buildSourceManifest(input.sources);
    const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
    const userMessage = `${context}\n\n${opts.taskInstruction}`;

    const { parsed, usage } = await callStructured({
      systemPrompt: opts.systemPrompt,
      userMessage,
      schema: opts.schema,
      maxTokens: opts.maxTokens,
    });

    const { sourceIds, droppedCount } = groundContentSources(parsed.source_references, labelToId);
    const droppedNote: EvidenceNote[] =
      droppedCount > 0
        ? [
            {
              claim: "来源引用",
              reason: "expert_review_required",
              note: `已自动移除 ${droppedCount} 条未在验证来源中找到的引用标签。`,
            },
          ]
        : [];
    const forbiddenNotes = buildForbiddenPhraseNotes(opts.textFieldsForScan(parsed));

    const grounded: T = {
      ...parsed,
      source_references: sourceIds,
      expert_review_notes: [...parsed.expert_review_notes, ...droppedNote, ...forbiddenNotes],
    };

    return {
      ok: true,
      content: grounded,
      modelAlias: MODEL_ALIAS,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: formatError(err),
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

export async function generateVideoChannelContent(
  input: EvidenceInput,
  customInstructions?: string | null,
): Promise<ContentAgentResult<VideoChannelContent>> {
  return runContentGeneration(input, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("video-editor", VIDEO_SYSTEM_PROMPT), customInstructions),
    taskInstruction: "Write the VIDEO_CHANNEL script now, following the structure and rules above.",
    schema: VideoChannelContentSchema,
    maxTokens: 8000,
    textFieldsForScan: (c) => [c.title, c.hook, c.cover_text, c.full_script, c.cta],
  });
}

export async function generateXiaohongshuContent(
  input: EvidenceInput,
  customInstructions?: string | null,
): Promise<ContentAgentResult<XiaohongshuContent>> {
  return runContentGeneration(input, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("xiaohongshu-editor", XHS_SYSTEM_PROMPT), customInstructions),
    taskInstruction: "Write the Xiaohongshu content now, following the structure and rules above.",
    schema: XiaohongshuContentSchema,
    maxTokens: 8000,
    textFieldsForScan: (c) => [...c.title_options, c.cover_title, ...c.pages, c.caption],
  });
}

export async function generateWechatOutline(
  input: EvidenceInput,
  customInstructions?: string | null,
): Promise<ContentAgentResult<WechatOutline>> {
  return runContentGeneration(input, {
    systemPrompt: appendCustomInstructions(buildSkillPrompt("wechat-editor", WECHAT_OUTLINE_SYSTEM_PROMPT), customInstructions),
    taskInstruction:
      "Write the WeChat Official Account OUTLINE now (not the full article), following the rules above.",
    schema: WechatOutlineSchema,
    maxTokens: 8000,
    textFieldsForScan: (c) => [...c.title_options, c.summary, ...c.detailed_outline, ...c.key_claims],
  });
}

export async function generateWechatFullArticle(
  input: EvidenceInput & {
    outline: Pick<WechatOutline, "title_options" | "summary" | "detailed_outline" | "key_claims">;
  },
  customInstructions?: string | null,
): Promise<ContentAgentResult<WechatFullArticle>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY 未配置，无法生成内容。",
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const { labelToId, manifestText } = buildSourceManifest(input.sources);
    const context = buildEvidenceContextBlock(input.topic, input.researchPack, manifestText);
    const outlineContext = buildOutlineContextBlock(input.outline);
    const userMessage = `${context}\n\n${outlineContext}\n\nWrite the full WeChat Official Account article now, following the outline and rules above.`;

    const { parsed, usage } = await callStructured({
      systemPrompt: appendCustomInstructions(buildSkillPrompt("wechat-editor", WECHAT_FULL_ARTICLE_SYSTEM_PROMPT), customInstructions),
      userMessage,
      schema: WechatFullArticleSchema,
      maxTokens: 16000,
    });

    const { sourceIds, droppedCount } = groundContentSources(parsed.source_references, labelToId);
    const droppedNote: EvidenceNote[] =
      droppedCount > 0
        ? [
            {
              claim: "来源引用",
              reason: "expert_review_required",
              note: `已自动移除 ${droppedCount} 条未在验证来源中找到的引用标签。`,
            },
          ]
        : [];
    const forbiddenNotes = buildForbiddenPhraseNotes([parsed.title, parsed.full_article]);

    const grounded: WechatFullArticle = {
      ...parsed,
      source_references: sourceIds,
      expert_review_notes: [...parsed.expert_review_notes, ...droppedNote, ...forbiddenNotes],
    };

    return {
      ok: true,
      content: grounded,
      modelAlias: MODEL_ALIAS,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: formatError(err),
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}
