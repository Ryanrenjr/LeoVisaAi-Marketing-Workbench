import type { PricingType } from "../ai/providers/types";

/**
 * Search Provider ≠ AI Model. This is a deliberately separate abstraction
 * from src/lib/ai/providers/ — a Research task first retrieves real
 * sources through here, then hands them to the Model Router for analysis.
 * No file outside src/lib/search/ and src/lib/ai/research-*.ts should
 * import a search provider SDK directly. See docs/search-router.md.
 */

export type SearchProviderId = "BRAVE" | "TAVILY";

export const SEARCH_PROVIDER_IDS: readonly SearchProviderId[] = ["BRAVE", "TAVILY"];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publisher: string | null;
  publishedDate: string | null;
  pageAge: string | null;
  retrievedAt: string;
  provider: SearchProviderId;
}

export interface SearchExecutionResult {
  provider: SearchProviderId;
  query: string;
  results: SearchResult[];
  latencyMs: number;
  success: boolean;
  error: string | null;
}

export interface SearchProviderRegistryEntry {
  provider: SearchProviderId;
  displayName: string;
  enabled: boolean;
  supportsDomainFiltering: boolean;
  pricingType: PricingType;
  freeTierNote: string | null;
  lastVerifiedAt: string;
}

/** Distinguishable failure categories — see docs/search-router.md "Error handling". Boss Mode collapses these; Admin Mode may show them precisely. */
export type SearchErrorCode =
  | "SEARCH_ROUTER_UNRESOLVED"
  | "SEARCH_PROVIDER_NOT_CONFIGURED"
  | "SEARCH_RATE_LIMITED"
  | "SEARCH_QUOTA_EXCEEDED"
  | "SEARCH_FAILED";

export interface SearchTaskFailure {
  ok: false;
  errorCode: SearchErrorCode;
  error: string;
}

export interface SearchTaskSuccess {
  ok: true;
  provider: SearchProviderId;
  executions: SearchExecutionResult[];
}

export type SearchTaskResult = SearchTaskSuccess | SearchTaskFailure;
