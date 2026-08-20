// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. global fetch is mocked
// below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runTavilySearch, isTavilyConfigured } = await import("./tavily-provider");

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

  it("passes include_domains through when provided", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await runTavilySearch("query", { includeDomains: ["gov.uk", "legislation.gov.uk"] });
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.include_domains).toEqual(["gov.uk", "legislation.gov.uk"]);
  });
});
