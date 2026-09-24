import "server-only";
import { runTavilyExtract } from "./providers/tavily-provider";

/**
 * The Search abstraction's official-source enrichment step (Round 4):
 *
 *   Research Task → Search Router (discover sources) → this module (read
 *   real page content for a few top-ranked official sources) → Model
 *   Router (reason over the evidence)
 *
 * The AI/business layer (src/lib/ai/router.ts) must not import
 * providers/tavily-provider.ts directly — this is the one seam it goes
 * through instead, mirroring how src/lib/search/router.ts is the only
 * seam for search itself. See docs/search-router.md "Official source
 * extraction".
 *
 * Deliberately NOT a general-purpose "fetch any URL" capability: every
 * URL passed in is expected to already be a real Search Router result
 * (the caller uses research-queries.ts's selectOfficialSourcesForExtraction
 * to pick them), and this function re-validates https + a hard cap +
 * dedupe defensively rather than trusting the caller alone — no
 * localhost/private-network/arbitrary-scheme URL ever reaches Tavily
 * through this path.
 */

export const MAX_EXTRACT_URLS = 3;
const MAX_CHARS_PER_SOURCE = 6000;

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function capContent(content: string): string {
  if (content.length <= MAX_CHARS_PER_SOURCE) return content;
  return `${content.slice(0, MAX_CHARS_PER_SOURCE)}\n（内容因长度限制被截断）`;
}

export interface ExtractedOfficialSource {
  url: string;
  content: string;
}

export interface FailedOfficialExtraction {
  url: string;
  error: string;
}

export interface OfficialExtractionOutcome {
  extracted: ExtractedOfficialSource[];
  failed: FailedOfficialExtraction[];
  latencyMs: number;
}

/**
 * Reads real page content for up to MAX_EXTRACT_URLS official sources,
 * relevance-ranked toward `query` (Tavily's query-focused chunk
 * reranking — see runTavilyExtract). A request-level failure (network,
 * not configured) is never thrown up to the caller — it comes back as
 * every URL landing in `failed`, so Research can keep going with
 * SEARCH_SNIPPET evidence for those sources instead. This is quality
 * enrichment, not a search-availability gate.
 */
export async function extractOfficialSources(
  urls: readonly string[],
  query: string,
): Promise<OfficialExtractionOutcome> {
  const started = Date.now();
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const url of urls) {
    if (targets.length >= MAX_EXTRACT_URLS) break;
    if (!isHttpsUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    targets.push(url);
  }

  if (targets.length === 0) {
    return { extracted: [], failed: [], latencyMs: Date.now() - started };
  }

  const result = await runTavilyExtract(targets, { query, chunksPerSource: 3 });

  if (!result.success) {
    return {
      extracted: [],
      failed: targets.map((url) => ({ url, error: result.error ?? "官方来源正文提取失败。" })),
      latencyMs: Date.now() - started,
    };
  }

  return {
    extracted: result.extracted.map((e) => ({ url: e.url, content: capContent(e.rawContent) })),
    failed: result.failed,
    latencyMs: Date.now() - started,
  };
}
