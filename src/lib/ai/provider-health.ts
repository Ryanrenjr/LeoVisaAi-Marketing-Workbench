import "server-only";
import { z } from "zod";
import { listModels, isProviderConfigured, getModel } from "./providers/registry";
import { generateAnthropicStructured } from "./providers/anthropic-provider";
import { generateGoogleStructured } from "./providers/google-provider";
import { generateGroqStructured } from "./providers/groq-provider";
import { generateOpenRouterStructured } from "./providers/openrouter-provider";
import { generateOpenAIStructured, isOpenAIModelAvailable } from "./providers/openai-provider";
import type { AIProviderId } from "./providers/types";

/**
 * ADMIN-only development diagnostic — NOT a product feature. Confirms a
 * provider/model is reachable with a single harmless synthetic request
 * before trusting it for a real Research/Content run. See
 * docs/provider-smoke-test.md.
 */

export type HealthCheckStatus = "NOT_CONFIGURED" | "SUCCESS" | "FAILED";

export interface HealthCheckResult {
  provider: AIProviderId;
  status: HealthCheckStatus;
  modelId: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

const HealthPingSchema = z.object({ status: z.literal("ok") });

const HEALTH_CHECK_PROMPT =
  'Reply with ONLY this exact JSON object, nothing else: {"status": "ok"}. This is a harmless connectivity check — no real content is being requested.';

/** Picks the lightest development-recommended, structured-output-capable model registered for a provider — the Registry stays the single source of truth, nothing hard-coded here. */
function pickHealthCheckModel(provider: AIProviderId): string | null {
  const candidates = listModels().filter(
    (m) => m.provider === provider && m.enabled && m.supportsStructuredOutput,
  );
  const recommended = candidates.find((m) => m.developmentRecommended);
  return (recommended ?? candidates[0])?.modelId ?? null;
}

/** Every structured-output provider gets a real ping with the exact modelId given — never a substitute model. */
const HEALTH_CHECK_DISPATCH: Record<
  AIProviderId,
  (modelId: string) => Promise<{ ok: boolean; error: string | null; inputTokens: number | null; outputTokens: number | null }>
> = {
  ANTHROPIC: async (modelId) => {
    const result = await generateAnthropicStructured({
      systemPrompt: "You respond only with the exact JSON requested.",
      userMessage: HEALTH_CHECK_PROMPT,
      schema: HealthPingSchema,
      maxTokens: 64,
      modelId,
    });
    return { ok: result.ok, error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  },
  GOOGLE: async (modelId) => {
    const result = await generateGoogleStructured({
      systemPrompt: "You respond only with the exact JSON requested.",
      userMessage: HEALTH_CHECK_PROMPT,
      schema: HealthPingSchema,
      modelId,
    });
    return { ok: result.ok, error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  },
  GROQ: async (modelId) => {
    const result = await generateGroqStructured({
      systemPrompt: "You respond only with the exact JSON requested.",
      userMessage: HEALTH_CHECK_PROMPT,
      schema: HealthPingSchema,
      modelId,
    });
    return { ok: result.ok, error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  },
  OPENROUTER: async (modelId) => {
    const result = await generateOpenRouterStructured({
      systemPrompt: "You respond only with the exact JSON requested.",
      userMessage: HEALTH_CHECK_PROMPT,
      schema: HealthPingSchema,
      modelId,
    });
    return { ok: result.ok, error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  },
  OPENAI: async (modelId) => {
    const result = await generateOpenAIStructured({
      systemPrompt: "You respond only with the exact JSON requested.",
      userMessage: HEALTH_CHECK_PROMPT,
      schema: HealthPingSchema,
      modelId,
    });
    return { ok: result.ok, error: result.error, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  },
};

/**
 * Tests ONE exact (provider, modelId) pair — the model actually selected
 * for a task, not a stand-in "lightest model for this provider." Image-
 * generation models (gpt-image-2) never run the real (billable) generation
 * endpoint here — see isOpenAIModelAvailable — so this check never spends
 * money on its own.
 */
export async function checkModelHealth(provider: AIProviderId, modelId: string): Promise<HealthCheckResult> {
  if (!isProviderConfigured(provider)) {
    return {
      provider,
      status: "NOT_CONFIGURED",
      modelId,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      error: null,
    };
  }

  const started = Date.now();
  const model = getModel(provider, modelId);

  if (model?.supportsImageGeneration) {
    const { ok, error } = await isOpenAIModelAvailable(modelId);
    return {
      provider,
      status: ok ? "SUCCESS" : "FAILED",
      modelId,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      error: ok ? null : error,
    };
  }

  const { ok, error, inputTokens, outputTokens } = await HEALTH_CHECK_DISPATCH[provider](modelId);
  return {
    provider,
    status: ok ? "SUCCESS" : "FAILED",
    modelId,
    latencyMs: Date.now() - started,
    inputTokens,
    outputTokens,
    error: ok ? null : error,
  };
}

/** Provider-level check (供应商连接状态 section) — picks a representative model on the caller's behalf. */
export async function checkProviderHealth(provider: AIProviderId): Promise<HealthCheckResult> {
  if (!isProviderConfigured(provider)) {
    return {
      provider,
      status: "NOT_CONFIGURED",
      modelId: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      error: null,
    };
  }

  const modelId = pickHealthCheckModel(provider);
  if (!modelId) {
    return {
      provider,
      status: "FAILED",
      modelId: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      error: "没有为该供应商注册可用于健康检查的模型。",
    };
  }

  return checkModelHealth(provider, modelId);
}
