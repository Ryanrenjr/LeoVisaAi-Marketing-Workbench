import type { SearchProviderId, SearchProviderRegistryEntry } from "./types";

/**
 * The single source of truth for search provider metadata — mirrors
 * src/lib/ai/providers/registry.ts's role for AI models. EXA,
 * GOOGLE_GROUNDING, and ANTHROPIC_WEB_SEARCH are deliberately NOT
 * registered here — see docs/search-router.md "How to add a future
 * Search Provider" for why (native Google/Anthropic grounding already
 * exists as a separate, fully-supported fallback path in
 * src/lib/ai/router.ts, not modeled as a Search Provider entry, to avoid
 * conflating "a pure search step" with "a combined search+model call").
 */
export const SEARCH_PROVIDER_REGISTRY: readonly SearchProviderRegistryEntry[] = [
  {
    provider: "TAVILY",
    displayName: "Tavily Search",
    enabled: true,
    supportsDomainFiltering: true,
    supportsImageSearch: false,
    // Confirmed FREE: 1,000 API credits/month, no credit card required.
    // The current development default — see docs/search-router.md.
    pricingType: "FREE",
    freeTierNote: "Tavily 免费层，每月 1,000 次调用额度，无需信用卡。",
    lastVerifiedAt: "2026-08-20",
  },
  {
    provider: "BRAVE",
    displayName: "Brave Search",
    enabled: true,
    supportsDomainFiltering: true,
    supportsImageSearch: false,
    // Brave removed its free API tier in 2026-02 — confirmed live via the
    // dashboard on 2026-08-20 ("No subscriptions found... subscribe to a
    // plan before generating API keys"). Pay-as-you-go only (~$5 prepaid
    // credit, $0.003-0.005/query, no free plan). Do NOT change this back
    // to FREE without re-verifying — see docs/search-router.md. Kept
    // registered (disabled from automatic dev-mode selection by its
    // pricing tier, not by `enabled`) as a available-but-not-preferred
    // alternative — see docs/search-router.md "Existing Brave attempt".
    pricingType: "PAID",
    freeTierNote: null,
    lastVerifiedAt: "2026-08-20",
  },
  {
    provider: "GOOGLE_IMAGES",
    displayName: "Google Custom Search (图片)",
    enabled: true,
    supportsDomainFiltering: false,
    supportsImageSearch: true,
    // Google Custom Search JSON API, searchType=image. Free tier: 100
    // queries/day, then $5/1000 queries (up to a daily cap). Live user
    // instruction: use real Google image results (not a stock-photo
    // library) for video-editor/wechat-editor reference images — the
    // tighter free quota vs. a stock library was explicitly accepted.
    pricingType: "MIXED",
    freeTierNote: "Google 免费额度每天 100 次查询，超出后按量计费（$5/1000次）。",
    lastVerifiedAt: "2026-08-21",
  },
] as const;

export function getSearchProvider(id: SearchProviderId): SearchProviderRegistryEntry | null {
  return SEARCH_PROVIDER_REGISTRY.find((p) => p.provider === id) ?? null;
}

export function listSearchProviders(): readonly SearchProviderRegistryEntry[] {
  return SEARCH_PROVIDER_REGISTRY;
}

// GOOGLE_IMAGES needs two vars (an API key + a Programmable Search Engine
// id) — every other provider needs one, so this stays a string | string[]
// map rather than widening every provider to an array.
const SEARCH_PROVIDER_ENV_VAR: Record<SearchProviderId, string | string[]> = {
  TAVILY: "TAVILY_API_KEY",
  BRAVE: "BRAVE_SEARCH_API_KEY",
  GOOGLE_IMAGES: ["GOOGLE_CSE_API_KEY", "GOOGLE_CSE_ID"],
};

export function isSearchProviderConfigured(id: SearchProviderId): boolean {
  const envVar = SEARCH_PROVIDER_ENV_VAR[id];
  const names = Array.isArray(envVar) ? envVar : [envVar];
  return names.every((name) => Boolean(process.env[name]));
}

export function searchProviderEnvVarName(id: SearchProviderId): string {
  const envVar = SEARCH_PROVIDER_ENV_VAR[id];
  return Array.isArray(envVar) ? envVar.join(" 和 ") : envVar;
}
