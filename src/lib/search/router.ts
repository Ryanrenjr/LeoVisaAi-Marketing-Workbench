import "server-only";
import { selectSearchProvider } from "./search-selection";
import { isSearchProviderConfigured } from "./registry";
import { runBraveSearch } from "./providers/brave-provider";
import { runTavilySearch } from "./providers/tavily-provider";
import type { ResearchSearchInput, SearchErrorCode, SearchProviderId, SearchTaskResult } from "./types";

function normalizeQuery(input: ResearchSearchInput): { query: string; includeDomains?: readonly string[] } {
  return typeof input === "string" ? { query: input } : input;
}

/**
 * The Search Router: Research Task → Search Router → Search Provider →
 * Retrieved Sources. The only place the rest of the app should reach to
 * run a search — research business logic must not call a search provider
 * SDK directly. See docs/search-router.md.
 */

export function isSearchDevelopmentMode(): boolean {
  return process.env.AI_DEVELOPMENT_MODE === "true";
}

export function resolveSearchProvider(executionOverride?: SearchProviderId | null) {
  return selectSearchProvider({
    developmentMode: isSearchDevelopmentMode(),
    configuredDefault: null, // nothing to persist yet — see search-selection.ts
    executionOverride: executionOverride ?? null,
  });
}

function classifySearchError(error: string): SearchErrorCode {
  if (/quota|credit/i.test(error)) return "SEARCH_QUOTA_EXCEEDED";
  if (/429|rate.?limit/i.test(error)) return "SEARCH_RATE_LIMITED";
  return "SEARCH_FAILED";
}

/**
 * Runs every query in sequence against the resolved provider, stopping at
 * the first failure (never burning quota on queries after one has already
 * failed). Not configured vs. configured-but-failing are distinguished so
 * the caller (research-search-flow.ts) can decide: "not configured" falls
 * through to the native-grounding path; a real failure (rate limit, etc.)
 * does not — no silent substitution once a provider is actually in use.
 */
export async function runResearchSearch(
  queries: readonly ResearchSearchInput[],
  executionOverride?: SearchProviderId | null,
): Promise<SearchTaskResult> {
  const resolution = resolveSearchProvider(executionOverride);
  if (!resolution.ok) {
    return { ok: false, errorCode: "SEARCH_ROUTER_UNRESOLVED", error: resolution.error };
  }

  const provider = resolution.provider.provider;

  if (!isSearchProviderConfigured(provider)) {
    return {
      ok: false,
      errorCode: "SEARCH_PROVIDER_NOT_CONFIGURED",
      error: "免费搜索服务当前不可用，请稍后重试或由管理员选择其他服务。",
    };
  }

  const executions = [];
  for (const rawQuery of queries) {
    const { query, includeDomains } = normalizeQuery(rawQuery);
    // Tavily supports include_domains natively (runTavilySearch). Brave
    // has no domain-filtering support in this app's implementation — it
    // genuinely ignores includeDomains here rather than pretending to
    // honor it; see brave-provider.test.ts / router.test.ts for the
    // explicit coverage of that.
    const execution =
      provider === "TAVILY"
        ? await runTavilySearch(query, includeDomains ? { includeDomains: [...includeDomains] } : undefined)
        : provider === "BRAVE"
          ? await runBraveSearch(query)
          : null;
    if (!execution) {
      return { ok: false, errorCode: "SEARCH_FAILED", error: "未知搜索服务。" };
    }
    executions.push(execution);
    if (!execution.success) {
      return { ok: false, errorCode: classifySearchError(execution.error ?? ""), error: execution.error ?? "搜索失败。" };
    }
  }

  return { ok: true, provider, executions };
}
