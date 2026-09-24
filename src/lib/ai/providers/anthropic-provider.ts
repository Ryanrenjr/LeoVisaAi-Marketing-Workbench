import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import { runResearchAgent, type ResearchAgentResult } from "../research-agent";
import {
  generateVideoChannelContent,
  generateXiaohongshuContent,
  generateXiaohongshuPagesPlan,
  generateWechatOutline,
  generateWechatFullArticle,
  generateWechatArticle,
  type ContentAgentResult,
  type EvidenceInput,
} from "../content-agent";
import type { GroundedResearchPack } from "../research-pack";
import type {
  VideoChannelContent,
  XiaohongshuContent,
  XiaohongshuPagesPlan,
  WechatOutline,
  WechatFullArticle,
  WechatArticle,
  GenericContentTaskType,
} from "../content-schemas";
import type { AIExecutionResult } from "./types";

/**
 * Adapter, not a reimplementation: every call here delegates straight to
 * the existing, already-tested research-agent.ts / content-agent.ts —
 * those files are untouched by this milestone. This module only
 * normalizes their result shape into AIExecutionResult<T> for the router.
 * See docs/model-router.md "Anthropic provider".
 */

function adaptResearch(result: ResearchAgentResult): AIExecutionResult<GroundedResearchPack> {
  return {
    ok: result.ok,
    data: result.ok ? result.pack : null,
    error: result.ok ? null : result.error,
    provider: "ANTHROPIC",
    modelId: result.modelAlias,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  };
}

function adaptContent<T>(result: ContentAgentResult<T>): AIExecutionResult<T> {
  return {
    ok: result.ok,
    data: result.ok ? result.content : null,
    error: result.ok ? null : result.error,
    provider: "ANTHROPIC",
    modelId: result.modelAlias,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  };
}

export async function runAnthropicResearch(
  topic: {
    title: string;
    question: string;
    business: string;
    audience: string;
  },
  customInstructions?: string | null,
  modelId?: string,
): Promise<AIExecutionResult<GroundedResearchPack>> {
  return adaptResearch(await runResearchAgent(topic, customInstructions, modelId));
}

export async function runAnthropicContentTask(
  taskType: GenericContentTaskType,
  input: EvidenceInput,
  customInstructions?: string | null,
  modelId?: string,
): Promise<
  AIExecutionResult<VideoChannelContent | XiaohongshuContent | XiaohongshuPagesPlan | WechatOutline | WechatArticle>
> {
  if (taskType === "VIDEO_WRITING")
    return adaptContent(await generateVideoChannelContent(input, customInstructions, modelId));
  if (taskType === "XIAOHONGSHU_WRITING")
    return adaptContent(await generateXiaohongshuContent(input, customInstructions, modelId));
  if (taskType === "XIAOHONGSHU_PAGES_PLANNING")
    return adaptContent(await generateXiaohongshuPagesPlan(input, customInstructions, modelId));
  if (taskType === "WECHAT_ARTICLE_WRITING")
    return adaptContent(await generateWechatArticle(input, customInstructions, modelId));
  return adaptContent(await generateWechatOutline(input, customInstructions, modelId));
}

export async function runAnthropicWechatFullArticle(
  input: EvidenceInput & {
    outline: Pick<WechatOutline, "title_options" | "summary" | "detailed_outline" | "key_claims">;
  },
  customInstructions?: string | null,
  modelId?: string,
): Promise<AIExecutionResult<WechatFullArticle>> {
  return adaptContent(await generateWechatFullArticle(input, customInstructions, modelId));
}

function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function formatError(err: unknown): string {
  return err instanceof Anthropic.APIError
    ? `Anthropic API 错误 (${err.status}): ${err.message}`
    : err instanceof Error
      ? err.message
      : "未知错误";
}

export function parseStructuredResponse<T>(
  response: Anthropic.Message & { parsed_output?: unknown | null },
  schema: ZodType<T>,
): T {
  if (response.parsed_output) {
    const parsed = schema.safeParse(response.parsed_output);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`模型输出未通过结构校验：${issues}`);
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  const jsonText = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? text;

  if (jsonText) {
    try {
      const parsed = schema.safeParse(JSON.parse(jsonText));
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
      throw new Error(`模型输出未通过结构校验：${issues}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`模型输出未能解析为预期结构（停止原因：${response.stop_reason ?? "unknown"}）。`);
      }
      throw err;
    }
  }

  throw new Error(`模型输出未能解析为预期结构（停止原因：${response.stop_reason ?? "unknown"}）。`);
}

/**
 * Generic structured-output call, not tied to any content-schemas.ts task
 * config — used by the external-search Research path (Brave → analysis
 * model) so Anthropic can serve as that analysis model too, on equal
 * footing with Google/Groq/OpenRouter's generateXStructured functions.
 * Mirrors content-agent.ts's internal callStructured, parameterized by
 * modelId since that file hard-codes its own model alias.
 */
export async function generateAnthropicStructured<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  maxTokens: number;
  modelId: string;
}): Promise<AIExecutionResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "ANTHROPIC_API_KEY 未配置，无法运行分析。",
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: params.modelId,
      max_tokens: params.maxTokens,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userMessage }],
      output_config: { format: zodOutputFormat(params.schema) },
    });

    const data = parseStructuredResponse(response, params.schema);

    return {
      ok: true,
      data,
      error: null,
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Same contract as generateAnthropicStructured, plus one image content
 * block — used only by PERFORMANCE_ANALYSIS (reading a post-publish
 * screenshot). See docs/security-boundaries.md "Post-publish performance
 * data" — imageBase64 is always a screenshot Leo chose to upload, never
 * any other document type.
 */
export async function generateAnthropicStructuredFromImage<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  maxTokens: number;
  modelId: string;
  imageBase64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<AIExecutionResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "ANTHROPIC_API_KEY 未配置，无法读取截图。",
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: params.modelId,
      max_tokens: params.maxTokens,
      system: params.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: params.mimeType, data: params.imageBase64 } },
            { type: "text", text: params.userMessage },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(params.schema) },
    });

    const data = parseStructuredResponse(response, params.schema);

    return {
      ok: true,
      data,
      error: null,
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "ANTHROPIC",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}
