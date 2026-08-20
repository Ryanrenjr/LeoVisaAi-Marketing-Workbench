import { getSearchProvider, listSearchProviders } from "./registry";
import type { SearchProviderId, SearchProviderRegistryEntry } from "./types";

/**
 * Pure Search Router selection logic — mirrors
 * src/lib/ai/model-selection.ts's precedence exactly: an explicit
 * one-off override wins, then a persisted configured default (not
 * implemented this milestone — there is only one provider, so nothing to
 * persist yet; kept as a parameter for architectural symmetry and future
 * extensibility), then — only in Development Mode — the first enabled
 * FREE provider. No automatic FREE → PAID fallback.
 */

export interface SelectSearchProviderParams {
  developmentMode: boolean;
  configuredDefault: SearchProviderId | null;
  executionOverride: SearchProviderId | null;
}

export type SelectSearchProviderSource = "override" | "configured_default" | "development_free_first";

export type SelectSearchProviderResult =
  | { ok: true; provider: SearchProviderRegistryEntry; source: SelectSearchProviderSource }
  | { ok: false; error: string };

export function selectSearchProvider(params: SelectSearchProviderParams): SelectSearchProviderResult {
  const { developmentMode, configuredDefault, executionOverride } = params;

  if (executionOverride) {
    const provider = getSearchProvider(executionOverride);
    if (!provider || !provider.enabled) return { ok: false, error: "所选搜索服务不存在或已停用。" };
    return { ok: true, provider, source: "override" };
  }

  if (configuredDefault) {
    const provider = getSearchProvider(configuredDefault);
    if (provider && provider.enabled) return { ok: true, provider, source: "configured_default" };
    if (!developmentMode) {
      return { ok: false, error: "已配置的默认搜索服务当前不可用，请在「AI 模型配置」中重新选择。" };
    }
    // Stale/invalid configured default — fall through to free-first below in Development Mode.
  }

  if (developmentMode) {
    const candidate = listSearchProviders().find((p) => p.enabled && p.pricingType === "FREE");
    if (candidate) return { ok: true, provider: candidate, source: "development_free_first" };
    return { ok: false, error: "免费搜索服务当前不可用，请选择其他服务。" };
  }

  return { ok: false, error: "尚未为研究任务配置默认搜索服务。" };
}
