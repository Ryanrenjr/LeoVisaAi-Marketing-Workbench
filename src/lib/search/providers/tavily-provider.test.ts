// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. global fetch is mocked
// below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runTavilySearch, isTavilyConfigured, runTavilyExtract } = await import("./tavily-provider");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TAVILY_API_KEY", "tvly-test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isTavilyConfigured", () => {
  it("reports configured when TAVILY_API_KEY is set", () => {
    expect(isTavilyConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    expect(isTavilyConfigured()).toBe(false);
  });
});

describe("runTavilySearch", () => {
  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const result = await runTavilySearch("test query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TAVILY_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Bearer auth header and normalizes a successful response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "GOV.UK guidance",
            url: "https://www.gov.uk/example",
            content: "official summary",
            published_date: "2026-01-01",
          },
          { title: "No URL result", content: "should be filtered" },
        ],
      }),
    });

    const result = await runTavilySearch("老永居 gov.uk", { maxResults: 5 });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("TAVILY");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: "GOV.UK guidance",
      url: "https://www.gov.uk/example",
      snippet: "official summary",
      publisher: "gov.uk",
      publishedDate: "2026-01-01",
      provider: "TAVILY",
    });

    const [urlArg, requestInit] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe("https://api.tavily.com/search");
    expect(requestInit.headers.Authorization).toBe("Bearer tvly-test-key");
    const body = JSON.parse(requestInit.body);
    expect(body.query).toBe("老永居 gov.uk");
    expect(body.max_results).toBe(5);
  });

  it("normalizes a non-2xx HTTP response (e.g. quota exceeded) as a failure with the status in the message", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 432, text: async () => "quota exceeded" });
    const result = await runTavilySearch("query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/432/);
  });

  it("normalizes a network-level throw as a failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await runTavilySearch("query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down/);
  });

  it("passes include_domains through when provided, AND sets include_domains_mode: filter so it's a hard filter, not Tavily's default soft boost", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await runTavilySearch("query", { includeDomains: ["gov.uk", "legislation.gov.uk"] });
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.include_domains).toEqual(["gov.uk", "legislation.gov.uk"]);
    // Confirmed live against Tavily's real API (2026-09-15): without this,
    // include_domains only "boosts" — results from unlisted commercial
    // domains still came through.
    expect(body.include_domains_mode).toBe("filter");
  });

  it("does not send include_domains_mode when no includeDomains is given", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await runTavilySearch("query");
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.include_domains).toBeUndefined();
    expect(body.include_domains_mode).toBeUndefined();
  });
});

describe("runTavilyExtract", () => {
  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const result = await runTavilyExtract(["https://www.gov.uk/a"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TAVILY_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns immediately (success, nothing to do) when given no URLs", async () => {
    const result = await runTavilyExtract([]);
    expect(result.success).toBe(true);
    expect(result.extracted).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hits the extract endpoint with a Bearer header and the real Tavily request shape", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ url: "https://www.gov.uk/a", raw_content: "the real official page content" }],
        failed_results: [],
      }),
    });

    const result = await runTavilyExtract(["https://www.gov.uk/a"], { query: "ILR lapse rules", chunksPerSource: 3 });

    expect(result.success).toBe(true);
    expect(result.extracted).toEqual([{ url: "https://www.gov.uk/a", rawContent: "the real official page content" }]);

    const [urlArg, requestInit] = fetchMock.mock.calls[0];
    expect(String(urlArg)).toBe("https://api.tavily.com/extract");
    expect(requestInit.headers.Authorization).toBe("Bearer tvly-test-key");
    const body = JSON.parse(requestInit.body);
    expect(body.urls).toEqual(["https://www.gov.uk/a"]);
    expect(body.query).toBe("ILR lapse rules");
    expect(body.chunks_per_source).toBe(3);
  });

  it("reports per-URL failures via failed_results without treating the whole call as failed", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ url: "https://www.gov.uk/ok", raw_content: "content" }],
        failed_results: [{ url: "https://www.gov.uk/broken", error: "extraction timeout" }],
      }),
    });

    const result = await runTavilyExtract(["https://www.gov.uk/ok", "https://www.gov.uk/broken"]);
    expect(result.success).toBe(true);
    expect(result.extracted).toHaveLength(1);
    expect(result.failed).toEqual([{ url: "https://www.gov.uk/broken", error: "extraction timeout" }]);
  });

  it("treats a request-level failure (non-2xx) as every requested URL failing, not a thrown error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "server error" });
    const result = await runTavilyExtract(["https://www.gov.uk/a", "https://www.gov.uk/b"]);
    expect(result.success).toBe(false);
    expect(result.failed.map((f) => f.url)).toEqual(["https://www.gov.uk/a", "https://www.gov.uk/b"]);
  });

  it("normalizes a network-level throw as a failure for every URL", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await runTavilyExtract(["https://www.gov.uk/a"]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down/);
    expect(result.failed).toEqual([{ url: "https://www.gov.uk/a", error: "network down" }]);
  });
});
