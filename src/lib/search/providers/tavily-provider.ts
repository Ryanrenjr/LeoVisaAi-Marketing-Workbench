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
  /** Domains to prioritize — see docs/search-router.md "Primary source priority". Not a hard filter; kept small so useful non-listed official documents aren't excluded. */
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
          ? { include_domains: options.includeDomains }
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
