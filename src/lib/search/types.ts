import type { PricingType } from "../ai/providers/types";

/**
 * Search Provider ≠ AI Model. This is a deliberately separate abstraction
 * from src/lib/ai/providers/ — a Research task first retrieves real
 * sources through here, then hands them to the Model Router for analysis.
 * No file outside src/lib/search/ and src/lib/ai/research-*.ts should
 * import a search provider SDK directly. See docs/search-router.md.
 */

export type SearchProviderId = "BRAVE" | "TAVILY" | "GOOGLE_IMAGES";

export const SEARCH_PROVIDER_IDS: readonly SearchProviderId[] = ["BRAVE", "TAVILY", "GOOGLE_IMAGES"];

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
  /** Can search for real images (not just text/links) — required for the video-editor/wechat-editor image-search feature. */
  supportsImageSearch: boolean;
  pricingType: PricingType;
  freeTierNote: string | null;
  lastVerifiedAt: string;
}

/**
 * Image search is a genuinely different shape than text search (no
 * snippet; has a direct downloadable URL + dimensions + a source page for
 * attribution) — kept parallel to SearchResult/SearchExecutionResult/
 * SearchTaskResult rather than overloading them. See
 * src/lib/search/image-router.ts.
 */
export interface ImageSearchResult {
  title: string;
  /** Direct URL to fetch the image bytes from. */
  downloadUrl: string;
  /** The webpage the image was found on — kept for attribution/traceability only. */
  sourcePageUrl: string;
  width: number | null;
  height: number | null;
  provider: SearchProviderId;
}

export interface ImageSearchExecutionResult {
  provider: SearchProviderId;
  query: string;
  results: ImageSearchResult[];
  latencyMs: number;
  success: boolean;
  error: string | null;
}

export interface ImageSearchTaskSuccess {
  ok: true;
  provider: SearchProviderId;
  executions: ImageSearchExecutionResult[];
}

export type ImageSearchTaskResult = ImageSearchTaskSuccess | SearchTaskFailure;

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
