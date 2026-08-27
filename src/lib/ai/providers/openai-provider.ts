import "server-only";
import { z } from "zod";
import type { ZodType } from "zod";
import type { AIExecutionResult } from "./types";

/**
 * Real OpenAI implementation via raw HTTP (Chat Completions, JSON mode) —
 * mirrors openrouter-provider.ts's shape since both are OpenAI-compatible
 * REST. No registered OpenAI model claims web-search capability here, so
 * the Router never selects it for RESEARCH. See docs/model-router.md
 * "OpenAI provider".
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGES_EDIT_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

function isConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isOpenAIConfigured(): boolean {
  return isConfigured();
}

function formatError(err: unknown): string {
  return err instanceof Error ? `OpenAI API 错误：${err.message}` : "未知错误";
}

interface OpenAIResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generateOpenAIStructured<T>(params: {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  modelId: string;
  /** e.g. "medium" for gpt-5.6-terra — omit for models with no reasoning-effort knob. This app never sends `tools`, so the "tools + reasoning_effort" conflict some reasoning models have on /v1/chat/completions doesn't apply here. */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<AIExecutionResult<T>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "OPENAI_API_KEY 未配置，无法生成内容。",
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    // json_object mode only guarantees "valid JSON," not any particular
    // shape — it was silently letting the model return whatever fields it
    // felt like, which Zod then rejected wholesale (every field
    // "expected X, received undefined"). json_schema (Structured Outputs)
    // actually constrains generation to the real schema. Zod v4's
    // z.toJSONSchema() already emits additionalProperties:false and lists
    // every key in required for these schemas (none use .optional()), so
    // it satisfies OpenAI's strict-mode requirement without extra
    // patching — verified against a real request before shipping.
    const jsonSchema = z.toJSONSchema(params.schema);

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "response", schema: jsonSchema, strict: true },
        },
        ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as OpenAIResponse;
    const text = json.choices?.[0]?.message?.content;
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
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: json.usage?.prompt_tokens ?? null,
      outputTokens: json.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * OpenAI's Images API (the gpt-image family, e.g. gpt-image-2) — a
 * different endpoint shape than Chat Completions, so it's a separate
 * function rather than a mode on generateOpenAIStructured. Always returns
 * base64 PNG bytes (no `url` response_format on this model family) so the
 * caller can upload straight to Supabase Storage without a second fetch.
 */
export async function generateOpenAIImage(params: {
  prompt: string;
  modelId: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
}): Promise<AIExecutionResult<{ images: string[] }>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "OPENAI_API_KEY 未配置，无法生成图片。",
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const response = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId,
        prompt: params.prompt,
        size: params.size,
        n: 1,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as OpenAIImageResponse;
    const images = (json.data ?? []).map((d) => d.b64_json).filter((b): b is string => Boolean(b));
    if (images.length === 0) throw new Error("模型没有返回图片结果。");

    return {
      ok: true,
      data: { images },
      error: null,
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: json.usage?.input_tokens ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * The Images EDIT endpoint (multipart/form-data, not JSON) — takes one or
 * more real reference images plus a prompt and lets the model fuse them
 * into a newly generated image, instead of generating from text alone.
 * Used for "带李尔王特写" covers: the reference photo is a real,
 * ADMIN-uploaded photo of Leo (see src/lib/leo-portraits.ts) — the model
 * is asked to work his actual likeness into the cover design, not to
 * hallucinate a face from a text description. Same response shape as
 * generateOpenAIImage (always base64 PNG).
 */
export async function generateOpenAIImageEdit(params: {
  prompt: string;
  modelId: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  referenceImages: { bytes: Buffer; mimeType: string; filename: string }[];
}): Promise<AIExecutionResult<{ images: string[] }>> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      data: null,
      error: "OPENAI_API_KEY 未配置，无法生成图片。",
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const formData = new FormData();
    formData.append("model", params.modelId);
    formData.append("prompt", params.prompt);
    formData.append("size", params.size);
    formData.append("n", "1");
    for (const ref of params.referenceImages) {
      formData.append("image[]", new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }), ref.filename);
    }

    const response = await fetch(OPENAI_IMAGES_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as OpenAIImageResponse;
    const images = (json.data ?? []).map((d) => d.b64_json).filter((b): b is string => Boolean(b));
    if (images.length === 0) throw new Error("模型没有返回图片结果。");

    return {
      ok: true,
      data: { images },
      error: null,
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: json.usage?.input_tokens ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "OPENAI",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Auth + model-availability check WITHOUT spending money — used by the
 * "测试" button for image-generation models (see provider-health.ts).
 * Chat Completions / structured-output models get a real ping via a tiny
 * request; there's no equivalent free ping for an image model, so this
 * just confirms the key works and the exact modelId is visible to this
 * account via GET /v1/models, same check done manually before registering
 * gpt-image-2 in registry.ts.
 */
export async function isOpenAIModelAvailable(modelId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!isConfigured()) {
    return { ok: false, error: "OPENAI_API_KEY 未配置。" };
  }

  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const json = (await response.json()) as { data?: { id?: string }[] };
    const found = (json.data ?? []).some((m) => m.id === modelId);
    if (!found) throw new Error(`账户下未找到模型 ${modelId}（可能已改名/下线，或账户无权限）。`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
