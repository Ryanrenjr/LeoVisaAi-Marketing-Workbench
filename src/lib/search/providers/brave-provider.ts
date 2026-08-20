import "server-only";
import type { SearchExecutionResult, SearchResult } from "../types";

/**
 * Real Brave Search API implementation. No dedicated Brave SDK exists —
 * raw HTTP against the documented Web Search endpoint. See
 * docs/search-router.md "Brave Search provider".
 */

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

function isConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export function isBraveConfigured(): boolean {
  return isConfigured();
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

export async function runBraveSearch(query: string, count = 5): Promise<SearchExecutionResult> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      provider: "BRAVE",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: "BRAVE_SEARCH_API_KEY 未配置。",
    };
  }

  try {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY as string,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as BraveSearchResponse;
    const retrievedAt = new Date().toISOString();
    const results: SearchResult[] = (json.web?.results ?? [])
      .filter((r): r is BraveWebResult & { url: string } => Boolean(r.url))
      .map((r) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.description ?? "",
        publisher: safeHostname(r.url),
        publishedDate: r.age ?? r.page_age ?? null,
        pageAge: r.age ?? r.page_age ?? null,
        retrievedAt,
        provider: "BRAVE" as const,
      }));

    return { provider: "BRAVE", query, results, latencyMs: Date.now() - started, success: true, error: null };
  } catch (err) {
    return {
      provider: "BRAVE",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: err instanceof Error ? err.message : "未知错误",
    };
  }
}
