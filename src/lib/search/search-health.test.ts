// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. Both provider modules
// are fully mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runTavilySearchMock, runBraveSearchMock } = vi.hoisted(() => ({
  runTavilySearchMock: vi.fn(),
  runBraveSearchMock: vi.fn(),
}));
vi.mock("./providers/tavily-provider", () => ({ runTavilySearch: runTavilySearchMock }));
vi.mock("./providers/brave-provider", () => ({ runBraveSearch: runBraveSearchMock }));

const { checkSearchProviderHealth } = await import("./search-health");

beforeEach(() => {
  runTavilySearchMock.mockReset();
  runBraveSearchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkSearchProviderHealth", () => {
  it("reports NOT_CONFIGURED without calling the provider", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const result = await checkSearchProviderHealth("TAVILY");
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(runTavilySearchMock).not.toHaveBeenCalled();
  });

  it("reports SUCCESS with latency and result count on a real (mocked) success", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "UK government official website",
      results: [{ url: "https://www.gov.uk" }],
      latencyMs: 15,
      success: true,
      error: null,
    });
    const result = await checkSearchProviderHealth("TAVILY");
    expect(result.status).toBe("SUCCESS");
    expect(result.resultCount).toBe(1);
    expect(result.latencyMs).toBe(15);
  });

  it("reports FAILED with the provider's error message when the call fails", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
    runBraveSearchMock.mockResolvedValueOnce({
      provider: "BRAVE",
      query: "UK government official website",
      results: [],
      latencyMs: 5,
      success: false,
      error: "rate limited",
    });
    const result = await checkSearchProviderHealth("BRAVE");
    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("rate limited");
  });

  it("never exposes an API key in the result", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-super-secret-value");
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "UK government official website",
      results: [],
      latencyMs: 1,
      success: true,
      error: null,
    });
    const result = await checkSearchProviderHealth("TAVILY");
    expect(JSON.stringify(result)).not.toContain("tvly-super-secret-value");
  });
});
