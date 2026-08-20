import "server-only";
import Groq from "groq-sdk";
import type { ZodType } from "zod";
import type { AIExecutionResult } from "./types";

/**
 * Real Groq implementation. No registered Groq model in registry.ts claims
 * supports_web_search — Groq is used for drafting/classification/topic
 * work, not the Research Agent. See docs/model-router.md "Groq provider".
 */

function isConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function isGroqConfigured(): boolean {
  return isConfigured();
}

function formatError(err: unknown): string {
  return err instanceof Error ? `Groq API 错误：${err.message}` : "未知错误";
}

export async function generateGroqStructured<T>(params: {
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
      error: "GROQ_API_KEY 未配置，无法生成内容。",
      provider: "GROQ",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await client.chat.completions.create({
      model: params.modelId,
      messages: [
        {
          role: "system",
          content: `${params.systemPrompt}\n\nRespond with ONLY a single valid JSON object matching the required shape — no markdown fences, no commentary.`,
        },
        { role: "user", content: params.userMessage },
      ],
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content;
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
      provider: "GROQ",
      modelId: params.modelId,
      inputTokens: completion.usage?.prompt_tokens ?? null,
      outputTokens: completion.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: formatError(err),
      provider: "GROQ",
      modelId: params.modelId,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }
}
