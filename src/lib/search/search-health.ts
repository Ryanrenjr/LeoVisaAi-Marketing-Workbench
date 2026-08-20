import "server-only";
import { isSearchProviderConfigured } from "./registry";
import { runBraveSearch } from "./providers/brave-provider";
import { runTavilySearch } from "./providers/tavily-provider";
import type { SearchProviderId } from "./types";

/**
 * ADMIN-only development diagnostic — NOT a product feature. Mirrors
 * src/lib/ai/provider-health.ts for search providers. Confirms a provider
 * is reachable with a single harmless query before trusting it for a real
 * Research run. See docs/search-router.md.
 */

export type SearchHealthCheckStatus = "NOT_CONFIGURED" | "SUCCESS" | "FAILED";

export interface SearchHealthCheckResult {
  provider: SearchProviderId;
  status: SearchHealthCheckStatus;
  resultCount: number | null;
  latencyMs: number | null;
  error: string | null;
}

const HEALTH_CHECK_QUERY = "UK government official website";

const HEALTH_CHECK_DISPATCH: Record<SearchProviderId, (query: string) => Promise<{ success: boolean; error: string | null; resultCount: number; latencyMs: number }>> = {
  TAVILY: async (query) => {
    const result = await runTavilySearch(query, { maxResults: 1 });
    return { success: result.success, error: result.error, resultCount: result.results.length, latencyMs: result.latencyMs };
  },
  BRAVE: async (query) => {
    const result = await runBraveSearch(query, 1);
    return { success: result.success, error: result.error, resultCount: result.results.length, latencyMs: result.latencyMs };
  },
};

export async function checkSearchProviderHealth(provider: SearchProviderId): Promise<SearchHealthCheckResult> {
  if (!isSearchProviderConfigured(provider)) {
    return { provider, status: "NOT_CONFIGURED", resultCount: null, latencyMs: null, error: null };
  }

  const { success, error, resultCount, latencyMs } = await HEALTH_CHECK_DISPATCH[provider](HEALTH_CHECK_QUERY);

  return {
    provider,
    status: success ? "SUCCESS" : "FAILED",
    resultCount: success ? resultCount : null,
    latencyMs,
    error: success ? null : error,
  };
}
