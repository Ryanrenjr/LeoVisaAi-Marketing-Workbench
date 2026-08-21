import "server-only";
import type { ImageSearchExecutionResult, ImageSearchResult } from "../types";

/**
 * Real Google Custom Search JSON API implementation, image mode
 * (searchType=image) — real Google image results, not a stock-photo
 * library, by explicit live user instruction. Needs TWO env vars:
 * GOOGLE_CSE_API_KEY (from Google Cloud Console, "Custom Search API"
 * enabled) and GOOGLE_CSE_ID (a Programmable Search Engine configured to
 * search the whole web with image search on — programmablesearchengine.google.com).
 * Free tier: 100 queries/day, then billed — see registry.ts. No official
 * SDK; raw HTTP against the documented REST endpoint, same convention as
 * every other provider in this app. See docs/search-router.md.
 */

const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";

function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID);
}

export function isGoogleImageSearchConfigured(): boolean {
  return isConfigured();
}

interface GoogleCseImageItem {
  title?: string;
  link?: string;
  image?: {
    contextLink?: string;
    width?: number;
    height?: number;
  };
}

interface GoogleCseResponse {
  items?: GoogleCseImageItem[];
  error?: { message?: string };
}

export async function runGoogleImageSearch(
  query: string,
  maxResults = 3,
): Promise<ImageSearchExecutionResult> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      provider: "GOOGLE_IMAGES",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: "GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID 未配置。",
    };
  }

  try {
    const url = new URL(GOOGLE_CSE_URL);
    url.searchParams.set("key", process.env.GOOGLE_CSE_API_KEY!);
    url.searchParams.set("cx", process.env.GOOGLE_CSE_ID!);
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("safe", "active");
    // Kept small on purpose — the free tier is only 100 queries/day, and
    // each result item here counts toward the same query, not per-image.
    url.searchParams.set("num", String(Math.min(Math.max(maxResults, 1), 10)));

    const response = await fetch(url.toString());

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const json = (await response.json()) as GoogleCseResponse;
    if (json.error?.message) throw new Error(json.error.message);

    const results: ImageSearchResult[] = (json.items ?? [])
      .filter((item): item is GoogleCseImageItem & { link: string } => Boolean(item.link))
      .map((item) => ({
        title: item.title ?? query,
        downloadUrl: item.link,
        sourcePageUrl: item.image?.contextLink ?? item.link,
        width: item.image?.width ?? null,
        height: item.image?.height ?? null,
        provider: "GOOGLE_IMAGES" as const,
      }));

    return {
      provider: "GOOGLE_IMAGES",
      query,
      results,
      latencyMs: Date.now() - started,
      success: true,
      error: null,
    };
  } catch (err) {
    return {
      provider: "GOOGLE_IMAGES",
      query,
      results: [],
      latencyMs: Date.now() - started,
      success: false,
      error: err instanceof Error ? err.message : "未知错误",
    };
  }
}
