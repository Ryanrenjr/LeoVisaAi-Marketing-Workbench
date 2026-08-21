import "server-only";
import { isSearchProviderConfigured } from "./registry";
import { runGoogleImageSearch } from "./providers/google-image-search-provider";
import type { ImageSearchTaskResult, SearchErrorCode } from "./types";

/**
 * The Image Search Router — mirrors router.ts's text-search shape, kept as
 * a separate file rather than overloading router.ts since the provider
 * set and result shape genuinely differ (no snippet/publishedDate; has a
 * downloadable URL + dimensions). Only GOOGLE_IMAGES is registered today
 * (see registry.ts), so dispatch is a single branch — extend it the same
 * way router.ts's text dispatch would be extended if a second image
 * provider is ever added.
 */

function classifyImageSearchError(error: string): SearchErrorCode {
  if (/quota|credit/i.test(error)) return "SEARCH_QUOTA_EXCEEDED";
  if (/429|rate.?limit/i.test(error)) return "SEARCH_RATE_LIMITED";
  return "SEARCH_FAILED";
}

/**
 * Runs every query in sequence against GOOGLE_IMAGES, stopping at the
 * first failure — never burning the 100/day free quota on queries after
 * one has already failed. See docs/search-router.md "Error handling" for
 * the same not-configured-vs-failing distinction the text search router
 * makes.
 */
export async function runImageSearch(queries: readonly string[]): Promise<ImageSearchTaskResult> {
  if (!isSearchProviderConfigured("GOOGLE_IMAGES")) {
    return {
      ok: false,
      errorCode: "SEARCH_PROVIDER_NOT_CONFIGURED",
      error: "图片搜索未配置，请在 .env.local 设置 GOOGLE_CSE_API_KEY 和 GOOGLE_CSE_ID。",
    };
  }

  const executions = [];
  for (const query of queries) {
    const execution = await runGoogleImageSearch(query);
    executions.push(execution);
    if (!execution.success) {
      return {
        ok: false,
        errorCode: classifyImageSearchError(execution.error ?? ""),
        error: execution.error ?? "图片搜索失败。",
      };
    }
  }

  return { ok: true, provider: "GOOGLE_IMAGES", executions };
}
