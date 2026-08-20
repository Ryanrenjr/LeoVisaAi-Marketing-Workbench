// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. Both provider modules
// are fully mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runBraveSearchMock, runTavilySearchMock } = vi.hoisted(() => ({
  runBraveSearchMock: vi.fn(),
  runTavilySearchMock: vi.fn(),
}));
vi.mock("./providers/brave-provider", () => ({ runBraveSearch: runBraveSearchMock }));
vi.mock("./providers/tavily-provider", () => ({ runTavilySearch: runTavilySearchMock }));

const { runResearchSearch, isSearchDevelopmentMode } = await import("./router");

beforeEach(() => {
  runBraveSearchMock.mockReset();
  runTavilySearchMock.mockReset();
  vi.stubEnv("AI_DEVELOPMENT_MODE", "true");
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-key");
  vi.stubEnv("TAVILY_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSearchDevelopmentMode", () => {
  it("reads AI_DEVELOPMENT_MODE — shared with the Model Router's dev-mode flag", () => {
    expect(isSearchDevelopmentMode()).toBe(true);
    vi.stubEnv("AI_DEVELOPMENT_MODE", "false");
    expect(isSearchDevelopmentMode()).toBe(false);
  });
});

describe("runResearchSearch — Tavily (Development Mode default)", () => {
  it("selects Tavily automatically in Development Mode with no override", async () => {
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "q1",
      results: [{ url: "https://www.gov.uk/a" }],
      latencyMs: 10,
      success: true,
      error: null,
    });
    const result = await runResearchSearch(["q1"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe("TAVILY");
    expect(runTavilySearchMock).toHaveBeenCalledTimes(1);
    expect(runBraveSearchMock).not.toHaveBeenCalled();
  });

  it("returns SEARCH_PROVIDER_NOT_CONFIGURED without calling Tavily when the key is missing", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const result = await runResearchSearch(["q1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_PROVIDER_NOT_CONFIGURED");
    expect(runTavilySearchMock).not.toHaveBeenCalled();
  });

  it("runs every query and pools results when all succeed", async () => {
    runTavilySearchMock
      .mockResolvedValueOnce({ provider: "TAVILY", query: "q1", results: [{ url: "https://www.gov.uk/a" }], latencyMs: 10, success: true, error: null })
      .mockResolvedValueOnce({ provider: "TAVILY", query: "q2", results: [{ url: "https://www.gov.uk/b" }], latencyMs: 12, success: true, error: null });

    const result = await runResearchSearch(["q1", "q2"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.executions).toHaveLength(2);
    expect(runTavilySearchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a quota/credit error distinctly from a rate-limit error", async () => {
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "q1",
      results: [],
      latencyMs: 5,
      success: false,
      error: "monthly credit quota exceeded",
    });
    const result = await runResearchSearch(["q1", "q2", "q3"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_QUOTA_EXCEEDED");
    // Stops at the first failure — no wasted quota on q2/q3.
    expect(runTavilySearchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a 429/rate-limit error as SEARCH_RATE_LIMITED", async () => {
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "q1",
      results: [],
      latencyMs: 5,
      success: false,
      error: "HTTP 429: rate limited",
    });
    const result = await runResearchSearch(["q1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_RATE_LIMITED");
  });

  it("classifies a generic failure as SEARCH_FAILED", async () => {
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "q1",
      results: [],
      latencyMs: 5,
      success: false,
      error: "network error",
    });
    const result = await runResearchSearch(["q1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_FAILED");
  });

  it("never silently switches to a different (e.g. paid) provider when Tavily fails — the failure is returned as-is", async () => {
    runTavilySearchMock.mockResolvedValueOnce({
      provider: "TAVILY",
      query: "q1",
      results: [],
      latencyMs: 5,
      success: false,
      error: "HTTP 429: rate limited",
    });
    const result = await runResearchSearch(["q1"]);
    expect(result.ok).toBe(false);
    expect(runTavilySearchMock).toHaveBeenCalledTimes(1);
    expect(runBraveSearchMock).not.toHaveBeenCalled();
  });
});

describe("runResearchSearch — Brave (available but not preferred; requires explicit override)", () => {
  it("returns SEARCH_PROVIDER_NOT_CONFIGURED without calling Brave when explicitly selected but the key is missing", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    const result = await runResearchSearch(["query 1"], "BRAVE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_PROVIDER_NOT_CONFIGURED");
    expect(runBraveSearchMock).not.toHaveBeenCalled();
  });

  it("runs every query and succeeds when explicitly selected and all queries succeed", async () => {
    runBraveSearchMock
      .mockResolvedValueOnce({ provider: "BRAVE", query: "q1", results: [{ url: "https://gov.uk/a" }], latencyMs: 10, success: true, error: null })
      .mockResolvedValueOnce({ provider: "BRAVE", query: "q2", results: [{ url: "https://gov.uk/b" }], latencyMs: 12, success: true, error: null });

    const result = await runResearchSearch(["q1", "q2"], "BRAVE");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("BRAVE");
      expect(result.executions).toHaveLength(2);
    }
    expect(runBraveSearchMock).toHaveBeenCalledTimes(2);
    expect(runTavilySearchMock).not.toHaveBeenCalled();
  });

  it("classifies a rate-limit error and stops issuing further queries (no unnecessary quota use)", async () => {
    runBraveSearchMock.mockResolvedValueOnce({
      provider: "BRAVE",
      query: "q1",
      results: [],
      latencyMs: 5,
      success: false,
      error: "HTTP 429: rate limited",
    });

    const result = await runResearchSearch(["q1", "q2", "q3"], "BRAVE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("SEARCH_RATE_LIMITED");
    expect(runBraveSearchMock).toHaveBeenCalledTimes(1);
  });
});
