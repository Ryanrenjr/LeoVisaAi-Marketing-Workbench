import "server-only";
import { z } from "zod";
import { listModels, isProviderConfigured } from "./providers/registry";
import { generateGoogleStructured } from "./providers/google-provider";
import { generateGroqStructured } from "./providers/groq-provider";
import type { AIProviderId } from "./providers/types";

/**
 * ADMIN-only development diagnostic — NOT a product feature. Confirms a
 * provider is reachable with a single harmless synthetic request before
 * trusting it for a real Research/Content run. See
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

const HEALTH_CHECK_DISPATCH: Partial<
  Record<
    AIProviderId,
    (modelId: string) => Promise<{ ok: boolean; error: string | null; inputTokens: number | null; outputTokens: number | null }>
  >
> = {
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
};

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
  const dispatch = HEALTH_CHECK_DISPATCH[provider];
  if (!modelId || !dispatch) {
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

  const started = Date.now();
  const { ok, error, inputTokens, outputTokens } = await dispatch(modelId);
  const latencyMs = Date.now() - started;

  return {
    provider,
    status: ok ? "SUCCESS" : "FAILED",
    modelId,
    latencyMs,
    inputTokens,
    outputTokens,
    error: ok ? null : error,
  };
}
