import "server-only";
import type { SearchExecutionResult, SearchResult } from "../types";

/**
 * Real Tavily Search API implementation — the current development
 * default (free, no credit card required; see registry.ts). No official
 * Tavily SDK dependency added — raw HTTP against the documented REST
 * endpoint, matching this project's convention for providers without an
 * official SDK (see openrouter-provider.ts). See docs/search-router.md
 * "Tavily Search provider".
 */

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

function isConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export function isTavilyConfigured(): boolean {
  return isConfigured();
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export interface RunTavilySearchOptions {
  maxResults?: number;
  /**
   * Domains to restrict the search to — see docs/search-router.md
   * "Official-first Research Search". Sent as a HARD filter
   * (`include_domains_mode: "filter"`), not Tavily's default "boost"
   * (soft ranking preference) behavior: a real production run confirmed
   * live that `include_domains` alone (no mode set) still let results
   * from completely unlisted commercial domains through. `filter` mode
   * is required by Tavily's own API for this to actually restrict
   * results to the given domains.
   */
  includeDomains?: string[];
}

export async function runTavilySearch(
  query: string,
  options: RunTavilySearchOptions = {},
): Promise<SearchExecutionResult> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      provider: "TAVILY",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: "TAVILY_API_KEY 未配置。",
    };
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: options.maxResults ?? 5,
        ...(options.includeDomains && options.includeDomains.length > 0
          ? { include_domains: options.includeDomains, include_domains_mode: "filter" }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as TavilyResponse;
    const retrievedAt = new Date().toISOString();
    const results: SearchResult[] = (json.results ?? [])
      .filter((r): r is TavilyResult & { url: string } => Boolean(r.url))
      .map((r) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.content ?? "",
        publisher: safeHostname(r.url),
        publishedDate: r.published_date ?? null,
        pageAge: null,
        retrievedAt,
        provider: "TAVILY" as const,
      }));

    return { provider: "TAVILY", query, results, latencyMs: Date.now() - started, success: true, error: null };
  } catch (err) {
    return {
      provider: "TAVILY",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: err instanceof Error ? err.message : "未知错误",
    };
  }
}

export interface TavilyExtractedPage {
  url: string;
  /** May be the full page text or a relevance-ranked excerpt of it (see `query`/`chunksPerSource` below) — never assume it's necessarily the complete document. */
  rawContent: string;
}

export interface TavilyExtractFailure {
  url: string;
  error: string;
}

export interface TavilyExtractResult {
  /** False only for a request-level failure (not configured, network error, non-2xx) — a per-URL failure still returns `success: true` with that URL listed in `failed` instead. */
  success: boolean;
  extracted: TavilyExtractedPage[];
  failed: TavilyExtractFailure[];
  latencyMs: number;
  error: string | null;
}

export interface RunTavilyExtractOptions {
  /** "User intent for reranking extracted content chunks" (Tavily's own description) — when given, `raw_content` favors chunks relevant to this, rather than returning the page from the top. */
  query?: string;
  /** Max relevant chunks returned per source (Tavily: integer 1-5, default 3). Only has an effect together with `query`. */
  chunksPerSource?: number;
}

/**
 * Real Tavily Extract API implementation (POST /extract) — a genuinely
 * different operation from runTavilySearch (which only ever returns a
 * title + short snippet, never page content), so it's a separate function
 * rather than an option on search. Confirmed against Tavily's official
 * API reference on 2026-09-15: `urls` (string|string[]), optional `query`
 * + `chunks_per_source` for relevance-ranked chunk extraction, `format`
 * ("markdown"|"text"), `extract_depth` ("basic"|"advanced"). Response:
 * `results: [{url, raw_content}]` for succeeded URLs, `failed_results:
 * [{url, error}]` for the rest — both arrays, never a thrown error for a
 * single bad URL. See docs/search-router.md "Official source extraction".
 */
export async function runTavilyExtract(
  urls: string[],
  options: RunTavilyExtractOptions = {},
): Promise<TavilyExtractResult> {
  const started = Date.now();

  if (!isConfigured()) {
    return { success: false, extracted: [], failed: [], latencyMs: Date.now() - started, error: "TAVILY_API_KEY 未配置。" };
  }
  if (urls.length === 0) {
    return { success: true, extracted: [], failed: [], latencyMs: Date.now() - started, error: null };
  }

  try {
    const response = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls,
        format: "text",
        extract_depth: "basic",
        ...(options.query ? { query: options.query } : {}),
        ...(options.chunksPerSource ? { chunks_per_source: options.chunksPerSource } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as {
      results?: { url?: string; raw_content?: string }[];
      failed_results?: { url?: string; error?: string }[];
    };

    const extracted: TavilyExtractedPage[] = (json.results ?? [])
      .filter((r): r is { url: string; raw_content?: string } => Boolean(r.url))
      .map((r) => ({ url: r.url, rawContent: r.raw_content ?? "" }));
    const failed: TavilyExtractFailure[] = (json.failed_results ?? [])
      .filter((f): f is { url: string; error?: string } => Boolean(f.url))
      .map((f) => ({ url: f.url, error: f.error ?? "未知错误" }));

    return { success: true, extracted, failed, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    // A request-level failure (network, non-2xx) — every requested URL
    // counts as failed so the caller can fall back to snippets for all of
    // them, rather than silently dropping the extraction attempt.
    return {
      success: false,
      extracted: [],
      failed: urls.map((url) => ({ url, error: message })),
      latencyMs: Date.now() - started,
      error: message,
    };
  }
}
