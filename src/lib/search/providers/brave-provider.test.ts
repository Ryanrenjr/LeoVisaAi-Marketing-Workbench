// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. global fetch is mocked
// below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runBraveSearch, isBraveConfigured } = await import("./brave-provider");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isBraveConfigured", () => {
  it("reports configured when BRAVE_SEARCH_API_KEY is set", () => {
    expect(isBraveConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    expect(isBraveConfigured()).toBe(false);
  });
});

describe("runBraveSearch", () => {
  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    const result = await runBraveSearch("test query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BRAVE_SEARCH_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the subscription-token header and normalizes a successful response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "GOV.UK guidance", url: "https://www.gov.uk/example", description: "official summary", age: "3 days ago" },
            { title: "No URL result", description: "should be filtered" },
          ],
        },
      }),
    });

    const result = await runBraveSearch("老永居 gov.uk", 5);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("BRAVE");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: "GOV.UK guidance",
      url: "https://www.gov.uk/example",
      snippet: "official summary",
      publisher: "gov.uk",
      provider: "BRAVE",
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers["X-Subscription-Token"]).toBe("test-key");
  });

  it("normalizes a non-2xx HTTP response (e.g. rate limit) as a failure with the status in the message", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" });
    const result = await runBraveSearch("query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/429/);
  });

  it("normalizes a network-level throw as a failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await runBraveSearch("query");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network down/);
  });
});
