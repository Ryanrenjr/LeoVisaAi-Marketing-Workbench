import "server-only";
import type { ZodType } from "zod";
import type { AIExecutionResult } from "./types";

/**
 * Real OpenRouter implementation via raw HTTP (OpenAI-compatible REST) —
 * no dedicated official OpenRouter SDK exists. Experimental / A-B testing
 * surface: no registered OpenRouter model claims web-search capability, so
 * the Router never selects it for RESEARCH. See docs/model-router.md
 * "OpenRouter provider".
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function isConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function isOpenRouterConfigured(): boolean {
  return isConfigured();
}

function formatError(err: unknown): string {
  return err instanceof Error ? `OpenRouter API 错误：${err.message}` : "未知错误";
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generateOpenRouterStructured<T>(params: {
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
      error: "OPENROUTER_API_KEY 未配置，无法生成内容。",
      provider: "OPENROUTER",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId,
        messages: [
          {
            role: "system",
            content: `${params.systemPrompt}\n\nRespond with ONLY a single valid JSON object matching the required shape — no markdown fences, no commentary.`,
          },
          { role: "user", content: params.userMessage },
        ],
        response_format: { type: "json_object" },
        // Best-effort data-policy boundary on the routing layer itself —
        // this never substitutes for "don't send sensitive data" upstream.
        provider: { data_collection: "deny" },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as OpenRouterResponse;
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
      provider: "OPENROUTER",
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
      provider: "OPENROUTER",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}
