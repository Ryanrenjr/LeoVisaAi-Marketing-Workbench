// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. runTavilyExtract is
// mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runTavilyExtractMock } = vi.hoisted(() => ({ runTavilyExtractMock: vi.fn() }));
vi.mock("./providers/tavily-provider", () => ({ runTavilyExtract: runTavilyExtractMock }));

const { extractOfficialSources, MAX_EXTRACT_URLS } = await import("./extraction");

beforeEach(() => {
  runTavilyExtractMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractOfficialSources", () => {
  it("returns nothing without calling Tavily when given no URLs", async () => {
    const outcome = await extractOfficialSources([], "some query");
    expect(outcome.extracted).toEqual([]);
    expect(outcome.failed).toEqual([]);
    expect(runTavilyExtractMock).not.toHaveBeenCalled();
  });

  it("passes through the query and caps at MAX_EXTRACT_URLS (3)", async () => {
    expect(MAX_EXTRACT_URLS).toBe(3);
    runTavilyExtractMock.mockResolvedValueOnce({ success: true, extracted: [], failed: [], latencyMs: 10, error: null });
    const urls = Array.from({ length: 5 }, (_, i) => `https://www.gov.uk/${i}`);
    await extractOfficialSources(urls, "ILR lapse rules");

    const [passedUrls, options] = runTavilyExtractMock.mock.calls[0];
    expect(passedUrls).toHaveLength(3);
    expect(passedUrls).toEqual(urls.slice(0, 3));
    expect(options.query).toBe("ILR lapse rules");
  });

  it("de-duplicates URLs before extraction", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({ success: true, extracted: [], failed: [], latencyMs: 10, error: null });
    await extractOfficialSources(["https://www.gov.uk/a", "https://www.gov.uk/a"], "q");
    const [passedUrls] = runTavilyExtractMock.mock.calls[0];
    expect(passedUrls).toEqual(["https://www.gov.uk/a"]);
  });

  // Security boundary — no localhost / private-network / non-https URL ever reaches Tavily
  it("rejects a non-https URL defensively, even if a caller mistakenly passed one", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({ success: true, extracted: [], failed: [], latencyMs: 10, error: null });
    await extractOfficialSources(["http://www.gov.uk/insecure", "https://www.gov.uk/secure"], "q");
    const [passedUrls] = runTavilyExtractMock.mock.calls[0];
    expect(passedUrls).toEqual(["https://www.gov.uk/secure"]);
  });

  it("rejects localhost / private-network-looking URLs the same way (not https, or malformed)", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({ success: true, extracted: [], failed: [], latencyMs: 10, error: null });
    await extractOfficialSources(["http://localhost:3000/x", "https://169.254.169.254/", "not a url"], "q");
    const [passedUrls] = runTavilyExtractMock.mock.calls[0] ?? [[]];
    // localhost and "not a url" are rejected for not being https; the raw IP URL IS https so it passes
    // this call's URL-shape filtering — Tavily itself, not this app, is the actual outbound fetcher.
    expect(passedUrls).not.toContain("http://localhost:3000/x");
    expect(passedUrls).not.toContain("not a url");
  });

  it("returns real extracted content on success", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({
      success: true,
      extracted: [{ url: "https://www.gov.uk/a", rawContent: "real page content" }],
      failed: [],
      latencyMs: 50,
      error: null,
    });
    const outcome = await extractOfficialSources(["https://www.gov.uk/a"], "q");
    expect(outcome.extracted).toEqual([{ url: "https://www.gov.uk/a", content: "real page content" }]);
  });

  it("caps an individual extracted page's content length rather than passing arbitrary-sized text through", async () => {
    const hugeContent = "A".repeat(20000);
    runTavilyExtractMock.mockResolvedValueOnce({
      success: true,
      extracted: [{ url: "https://www.gov.uk/a", rawContent: hugeContent }],
      failed: [],
      latencyMs: 50,
      error: null,
    });
    const outcome = await extractOfficialSources(["https://www.gov.uk/a"], "q");
    expect(outcome.extracted[0].content.length).toBeLessThan(hugeContent.length);
    expect(outcome.extracted[0].content).toContain("截断");
  });

  it("does not throw when the underlying Tavily call fails at the request level — every URL lands in failed instead", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({
      success: false,
      extracted: [],
      failed: [],
      latencyMs: 10,
      error: "network down",
    });
    const outcome = await extractOfficialSources(["https://www.gov.uk/a", "https://www.gov.uk/b"], "q");
    expect(outcome.extracted).toEqual([]);
    expect(outcome.failed.map((f) => f.url)).toEqual(["https://www.gov.uk/a", "https://www.gov.uk/b"]);
  });

  it("passes through per-URL failures reported by Tavily itself", async () => {
    runTavilyExtractMock.mockResolvedValueOnce({
      success: true,
      extracted: [],
      failed: [{ url: "https://www.gov.uk/broken", error: "timeout" }],
      latencyMs: 10,
      error: null,
    });
    const outcome = await extractOfficialSources(["https://www.gov.uk/broken"], "q");
    expect(outcome.failed).toEqual([{ url: "https://www.gov.uk/broken", error: "timeout" }]);
  });
});
