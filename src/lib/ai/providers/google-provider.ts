import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ZodType } from "zod";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  parseResearchPackJson,
  buildGroundedPack,
  type GroundedResearchPack,
  type RealSearchResult,
} from "../research-pack";
import { appendCustomInstructions } from "../prompt-addendum";
import { buildSkillPrompt } from "../skills";
import type { AIExecutionResult } from "./types";

/**
 * Real Google Gemini implementation. Reuses the exact same prompt-building
 * and anti-hallucination grounding functions the Anthropic Research Agent
 * uses (research-pack.ts) — only the "call the model, get web-search
 * results back" mechanics differ per provider. See docs/model-router.md
 * "Google provider".
 */

function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_AI_API_KEY);
}

export function isGoogleConfigured(): boolean {
  return isConfigured();
}

function formatError(err: unknown): string {
  return err instanceof Error ? `Google AI 错误：${err.message}` : "未知错误";
}

function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
}

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

/**
 * Runs research via Gemini's Google Search grounding tool. Maps grounding
 * chunks into the same RealSearchResult shape the Anthropic path produces,
 * so buildGroundedPack (research-pack.ts) applies the identical
 * "never trust a claimed source that wasn't actually returned by a real
 * search" guarantee regardless of provider.
 */
export async function runGoogleResearch(
  topic: { title: string; question: string; business: string; audience: string },
  modelId: string,
  customInstructions?: string | null,
): Promise<AIExecutionResult<GroundedResearchPack>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "GOOGLE_AI_API_KEY 未配置，无法运行研究。",
      provider: "GOOGLE",
      modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const response = await client().models.generateContent({
      model: modelId,
      contents: buildResearchUserPrompt(topic),
      config: {
        systemInstruction: appendCustomInstructions(buildSkillPrompt("researcher", RESEARCH_SYSTEM_PROMPT), customInstructions),
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text;
    if (!text) throw new Error("模型没有返回文本结果。");

    const groundingChunks: GroundingChunk[] =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const realResults: RealSearchResult[] = groundingChunks
      .filter((c): c is { web: { uri: string; title?: string } } => Boolean(c.web?.uri))
      .map((c) => ({ title: c.web.title ?? c.web.uri, url: c.web.uri, pageAge: null }));

    const claim = parseResearchPackJson(text);
    const pack = buildGroundedPack(claim, realResults);

    return {
      ok: true,
      data: pack,
      error: null,
      provider: "GOOGLE",
      modelId,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
      toolUsage: { webSearchCount: realResults.length },
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "GOOGLE",
      modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Best-effort JSON Schema for `responseSchema` (below) — Gemini enforces
 * this shape server-side instead of only being told the shape via prose
 * in the prompt, which is what actually let a page-planning call return
 * `pages` as an array of objects instead of strings (live bug report: K's
 * 图文规划 failed Zod validation on Google specifically, never on
 * Anthropic, because only Anthropic's `output_config.format` was ever
 * schema-enforced at the API level — this closes that gap for Google
 * too). Wrapped in try/catch: not every Zod schema in this codebase is
 * guaranteed convertible (`.refine()`, certain unions, ...), and a
 * conversion failure must fall back to the old prompt-only behavior
 * rather than break the call outright.
 */
function tryBuildResponseSchema(schema: ZodType<unknown>): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Generic structured-content call for Gemini: JSON-mode output, parsed and
 * then re-validated with the caller's Zod schema — the same
 * "never trust the SDK's own shape guarantee, validate everything" rule
 * content-agent.ts already applies for Anthropic.
 */
export async function generateGoogleStructured<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  modelId: string;
}): Promise<AIExecutionResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "GOOGLE_AI_API_KEY 未配置，无法生成内容。",
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const response = await client().models.generateContent({
      model: params.modelId,
      contents: params.userMessage,
      config: {
        systemInstruction: params.systemPrompt,
        responseMimeType: "application/json",
        responseSchema: tryBuildResponseSchema(params.schema),
      },
    });

    const text = response.text;
    if (!text) throw new Error("模型没有返回文本结果。");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("模型输出不是有效的 JSON。");
    }

    const parsed = params.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      throw new Error(`模型输出未通过结构校验：${issues}`);
    }

    return {
      ok: true,
      data: parsed.data,
      error: null,
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Same contract as generateGoogleStructured, plus one inline image part —
 * used only by PERFORMANCE_ANALYSIS (reading a post-publish screenshot).
 * See docs/security-boundaries.md "Post-publish performance data".
 */
export async function generateGoogleStructuredFromImage<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  modelId: string;
  imageBase64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}): Promise<AIExecutionResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "GOOGLE_AI_API_KEY 未配置，无法读取截图。",
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const response = await client().models.generateContent({
      model: params.modelId,
      contents: [
        {
          role: "user",
          parts: [
            { text: params.userMessage },
            { inlineData: { mimeType: params.mimeType, data: params.imageBase64 } },
          ],
        },
      ],
      config: {
        systemInstruction: params.systemPrompt,
        responseMimeType: "application/json",
        responseSchema: tryBuildResponseSchema(params.schema),
      },
    });

    const text = response.text;
    if (!text) throw new Error("模型没有返回文本结果。");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("模型输出不是有效的 JSON。");
    }

    const parsed = params.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      throw new Error(`模型输出未通过结构校验：${issues}`);
    }

    return {
      ok: true,
      data: parsed.data,
      error: null,
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "GOOGLE",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}
