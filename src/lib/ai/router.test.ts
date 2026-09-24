// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. All provider modules
// and the DB-backed model-config module are fully mocked below; these
// tests never make a live network call or touch Supabase.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getModelRoutingConfigMock,
  runAnthropicResearchMock,
  runAnthropicContentTaskMock,
  runAnthropicWechatFullArticleMock,
  generateAnthropicStructuredMock,
  runGoogleResearchMock,
  generateGoogleStructuredMock,
  generateGroqStructuredMock,
  generateOpenRouterStructuredMock,
  runResearchSearchMock,
  resolveSearchProviderMock,
  isSearchProviderConfiguredMock,
  extractOfficialSourcesMock,
} = vi.hoisted(() => ({
  getModelRoutingConfigMock: vi.fn(),
  runAnthropicResearchMock: vi.fn(),
  runAnthropicContentTaskMock: vi.fn(),
  runAnthropicWechatFullArticleMock: vi.fn(),
  generateAnthropicStructuredMock: vi.fn(),
  runGoogleResearchMock: vi.fn(),
  generateGoogleStructuredMock: vi.fn(),
  generateGroqStructuredMock: vi.fn(),
  generateOpenRouterStructuredMock: vi.fn(),
  runResearchSearchMock: vi.fn(),
  resolveSearchProviderMock: vi.fn(),
  isSearchProviderConfiguredMock: vi.fn(),
  extractOfficialSourcesMock: vi.fn(),
}));

vi.mock("./model-config", () => ({ getModelRoutingConfig: getModelRoutingConfigMock }));
vi.mock("./providers/anthropic-provider", () => ({
  runAnthropicResearch: runAnthropicResearchMock,
  runAnthropicContentTask: runAnthropicContentTaskMock,
  runAnthropicWechatFullArticle: runAnthropicWechatFullArticleMock,
  generateAnthropicStructured: generateAnthropicStructuredMock,
}));
vi.mock("./providers/google-provider", () => ({
  runGoogleResearch: runGoogleResearchMock,
  generateGoogleStructured: generateGoogleStructuredMock,
}));
vi.mock("./providers/groq-provider", () => ({ generateGroqStructured: generateGroqStructuredMock }));
vi.mock("./providers/openrouter-provider", () => ({
  generateOpenRouterStructured: generateOpenRouterStructuredMock,
}));
vi.mock("../search/router", () => ({
  runResearchSearch: runResearchSearchMock,
  resolveSearchProvider: resolveSearchProviderMock,
}));
vi.mock("../search/registry", () => ({ isSearchProviderConfigured: isSearchProviderConfiguredMock }));
vi.mock("../search/extraction", () => ({ extractOfficialSources: extractOfficialSourcesMock }));

const {
  runResearchTask,
  runResearchOptimizationTask,
  runContentTask,
  runWechatFullArticleTask,
  runTopicDiscoveryTask,
  isRouterResolutionFailure,
  isDevelopmentMode,
} = await import("./router");

const TOPIC = { title: "t", question: "q", business: "b", audience: "a" };
const EVIDENCE_INPUT = {
  topic: { title: "t", question: "q", business: "b", audience: "a", content_pillar: null },
  researchPack: { summary: "s", key_findings: [], warnings: "", confidence: "HIGH" as const },
  sources: [],
};

beforeEach(() => {
  getModelRoutingConfigMock.mockReset().mockResolvedValue({});
  runAnthropicResearchMock.mockReset();
  runAnthropicContentTaskMock.mockReset();
  runAnthropicWechatFullArticleMock.mockReset();
  generateAnthropicStructuredMock.mockReset();
  runGoogleResearchMock.mockReset();
  generateGoogleStructuredMock.mockReset();
  generateGroqStructuredMock.mockReset();
  generateOpenRouterStructuredMock.mockReset();
  // Default: no external search provider configured — exercises the
  // fallback-to-native path, matching a real test/dev env with no Brave
  // key. Individual tests override this to exercise the external path.
  runResearchSearchMock.mockReset().mockResolvedValue({
    ok: false,
    errorCode: "SEARCH_PROVIDER_NOT_CONFIGURED",
    error: "BRAVE_SEARCH_API_KEY 未配置。",
  });
  // Default: a search provider resolves (Tavily) but isn't configured (no
  // API key) — matches the runResearchSearchMock default above, and keeps
  // resolveResearchSearchQueries's cheap pre-check from spending a Query
  // Planner call when nothing downstream will use planned queries anyway
  // (Round 4C). Tests exercising the real external-search path override
  // both to make search "available".
  resolveSearchProviderMock.mockReset().mockReturnValue({ ok: true, provider: { provider: "TAVILY" } });
  isSearchProviderConfiguredMock.mockReset().mockReturnValue(false);
  // Default: no official source is worth extracting / nothing extracted —
  // individual tests override this for the extraction-specific cases.
  extractOfficialSourcesMock.mockReset().mockResolvedValue({ extracted: [], failed: [], latencyMs: 0 });
  vi.stubEnv("AI_DEVELOPMENT_MODE", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDevelopmentMode", () => {
  it("reads AI_DEVELOPMENT_MODE=true", () => {
    expect(isDevelopmentMode()).toBe(true);
  });
  it("is false for anything else", () => {
    vi.stubEnv("AI_DEVELOPMENT_MODE", "false");
    expect(isDevelopmentMode()).toBe(false);
    vi.stubEnv("AI_DEVELOPMENT_MODE", "");
    expect(isDevelopmentMode()).toBe(false);
  });
});

describe("runResearchTask", () => {
  it("dispatches to the Google provider when Development Mode resolves a Google model (no configured default)", async () => {
    runGoogleResearchMock.mockResolvedValueOnce({
      ok: true,
      data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.6-flash",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
    });
    const { result } = await runResearchTask(TOPIC);
    // gemini-3.8-flash is now the developmentRecommended Flash model (Round 2) — Development Mode resolves to it, not the legacy 3.6.
    expect(runGoogleResearchMock).toHaveBeenCalledWith(TOPIC, "gemini-3.8-flash", null);
    expect(runAnthropicResearchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("GOOGLE");
  });

  it("dispatches to Anthropic when an override explicitly selects it", async () => {
    runAnthropicResearchMock.mockResolvedValueOnce({
      ok: true,
      data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
      error: null,
      provider: "ANTHROPIC",
      modelId: "claude-opus-5",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
    });
    const { result } = await runResearchTask(TOPIC, { provider: "ANTHROPIC", modelId: "claude-opus-5" });
    // Router must pass the resolved modelId through, not leave it to a hardcoded default (Round 2 fix).
    expect(runAnthropicResearchMock).toHaveBeenCalledWith(TOPIC, null, "claude-opus-5");
    expect(runGoogleResearchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("returns a resolution failure — with provider/modelId null — when the override lacks web-search capability, never contacting a provider", async () => {
    const { result } = await runResearchTask(TOPIC, { provider: "GROQ", modelId: "openai/gpt-oss-120b" });
    expect(isRouterResolutionFailure(result)).toBe(true);
    if (isRouterResolutionFailure(result)) {
      expect(result.error).toBe("此模型不支持当前研究流程所需的联网能力。");
      expect(result.provider).toBeNull();
    }
    expect(runGoogleResearchMock).not.toHaveBeenCalled();
    expect(runAnthropicResearchMock).not.toHaveBeenCalled();
  });

  it("honours ADMIN's persisted configured default from model_routing_config", async () => {
    getModelRoutingConfigMock.mockResolvedValueOnce({
      RESEARCH: { provider: "ANTHROPIC", modelId: "claude-opus-5" },
    });
    runAnthropicResearchMock.mockResolvedValueOnce({
      ok: true,
      data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
      error: null,
      provider: "ANTHROPIC",
      modelId: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await runResearchTask(TOPIC);
    expect(runAnthropicResearchMock).toHaveBeenCalled();
    expect(runGoogleResearchMock).not.toHaveBeenCalled();
  });

  describe("external-search path (Tavily → analysis model)", () => {
    const SEARCH_SUCCESS = {
      ok: true as const,
      provider: "TAVILY" as const,
      executions: [
        {
          provider: "TAVILY" as const,
          query: "老永居离境超过2年，身份还在吗？ gov.uk",
          results: [
            {
              title: "GOV.UK — returning resident guidance",
              url: "https://www.gov.uk/returning-resident",
              snippet: "Official guidance on returning resident visas.",
              publisher: "gov.uk",
              publishedDate: null,
              pageAge: null,
              retrievedAt: "2026-08-20T00:00:00.000Z",
              provider: "TAVILY" as const,
            },
          ],
          latencyMs: 120,
          success: true,
          error: null,
        },
      ],
    };

    // Round 4C — makes the cheap pre-check in resolveResearchSearchQueries
    // report a real, configured search provider, so the Query Planner
    // actually runs (rather than being skipped as it is by default —
    // see beforeEach). Every test below that exercises the real
    // external-search path needs this.
    function makeSearchAvailable() {
      resolveSearchProviderMock.mockReturnValueOnce({ ok: true, provider: { provider: "TAVILY" } });
      isSearchProviderConfiguredMock.mockReturnValueOnce(true);
    }

    // The Query Planner (RESEARCH_QUERY_PLANNING) resolves to the same
    // Development-Mode default as every other generic task (GOOGLE/
    // gemini-3.8-flash) with no configured default — so it consumes the
    // FIRST queued generateGoogleStructuredMock value; the real research
    // analysis call consumes the second.
    const PLANNER_SUCCESS = {
      ok: true as const,
      data: { official_query: "test official query", legal_query: "test legal query", general_query: "test general query" },
      error: null,
      provider: "GOOGLE" as const,
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    };

    it("runs Search + Gemini analysis end to end and grounds the result against real search results", async () => {
      makeSearchAvailable();
      runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
      generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: {
          summary: "摘要",
          key_findings: ["发现一"],
          source_references: ["S1", "S99"],
          warnings: "",
          confidence: "MEDIUM",
        },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.6-flash",
        inputTokens: 50,
        outputTokens: 20,
        latencyMs: 300,
      });

      const { result, searchMeta } = await runResearchTask(TOPIC);

      expect(result.ok).toBe(true);
      expect(result.provider).toBe("GOOGLE");
      if (result.ok && result.data) {
        // S1 resolves to the real Tavily result; S99 (invented) is dropped —
        // search results remain the source boundary, exactly like the
        // native path's URL-grounding guarantee.
        expect(result.data.sources).toHaveLength(1);
        expect(result.data.sources[0].url).toBe("https://www.gov.uk/returning-resident");
        expect(result.data.warnings).toMatch(/自动移除 1 条/);
      }
      expect(searchMeta).toEqual({
        provider: "TAVILY",
        queryCount: expect.any(Number),
        resultCount: 1,
        latencyMs: 120,
        success: true,
        error: null,
      });
    });

    it("does NOT call Gemini's native search-grounding function on the external-search path", async () => {
      makeSearchAvailable();
      runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
      generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.6-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      await runResearchTask(TOPIC);

      expect(generateGoogleStructuredMock).toHaveBeenCalled();
      expect(runGoogleResearchMock).not.toHaveBeenCalled();
    });

    // Round 4 — official source extraction integration tests
    describe("official source extraction", () => {
      it("TEST 4: real extracted content reaches the model's user prompt (extraction/reranking still costs no extra AI call beyond the Query Planner)", async () => {
        makeSearchAvailable();
        extractOfficialSourcesMock.mockResolvedValueOnce({
          extracted: [{ url: "https://www.gov.uk/returning-resident", content: "REAL OFFICIAL PAGE CONTENT about returning resident rules" }],
          failed: [],
          latencyMs: 80,
        });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: ["S1"], warnings: "", confidence: "HIGH" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        await runResearchTask(TOPIC);

        // TEST 13 — exactly two AI calls total this round: Query Planner + research analysis.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(2);

        // The extracted official content actually reached the SECOND
        // (analysis) call's prompt, not just the snippet.
        const analysisCall = generateGoogleStructuredMock.mock.calls[1][0];
        expect(analysisCall.userMessage).toContain("REAL OFFICIAL PAGE CONTENT about returning resident rules");
        expect(analysisCall.userMessage).toContain("OFFICIAL_EXTRACT");
      });

      it("TEST 6: extraction failure does not fail Research — falls back to the snippet and continues", async () => {
        makeSearchAvailable();
        extractOfficialSourcesMock.mockResolvedValueOnce({
          extracted: [],
          failed: [{ url: "https://www.gov.uk/returning-resident", error: "extraction timeout" }],
          latencyMs: 30,
        });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: ["S1"], warnings: "", confidence: "MEDIUM" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        const { result } = await runResearchTask(TOPIC);

        expect(result.ok).toBe(true);
        if (result.ok && result.data) {
          expect(result.data.warnings).toContain("未读取官方页面正文");
        }
        const analysisCall = generateGoogleStructuredMock.mock.calls[1][0];
        expect(analysisCall.userMessage).toContain("Evidence type: SEARCH_SNIPPET");
        expect(analysisCall.userMessage).toContain("Official guidance on returning resident visas.");
      });

      it("only attempts extraction for primary-source URLs found by search, never for arbitrary/commercial URLs", async () => {
        makeSearchAvailable();
        runResearchSearchMock.mockResolvedValueOnce({
          ok: true,
          provider: "TAVILY" as const,
          executions: [
            {
              provider: "TAVILY" as const,
              query: "q",
              results: [
                {
                  title: "Commercial immigration blog",
                  url: "https://some-immigration-blog.example.com/x",
                  snippet: "commercial snippet",
                  publisher: "example.com",
                  publishedDate: null,
                  pageAge: null,
                  retrievedAt: "2026-08-20T00:00:00.000Z",
                  provider: "TAVILY" as const,
                },
              ],
              latencyMs: 10,
              success: true,
              error: null,
            },
          ],
        });
        generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        await runResearchTask(TOPIC);

        expect(extractOfficialSourcesMock).not.toHaveBeenCalled();
      });

      // TEST 8 (Round 4B) — when search finds both a bare official
      // homepage AND a specific official page, the specific page must be
      // the one selected for extraction (rankSearchResults' homepage
      // demotion feeding selectOfficialSourcesForExtraction).
      it("TEST 8: prefers a specific official page over a bare homepage for extraction", async () => {
        makeSearchAvailable();
        runResearchSearchMock.mockResolvedValueOnce({
          ok: true,
          provider: "TAVILY" as const,
          executions: [
            {
              provider: "TAVILY" as const,
              query: "q",
              results: [
                {
                  title: "Welcome to GOV.UK",
                  url: "https://www.gov.uk",
                  snippet: "homepage",
                  publisher: "gov.uk",
                  publishedDate: null,
                  pageAge: null,
                  retrievedAt: "2026-08-20T00:00:00.000Z",
                  provider: "TAVILY" as const,
                },
                {
                  title: "Return to the UK if you had indefinite leave to remain",
                  url: "https://www.gov.uk/returning-resident-visa",
                  snippet: "the real relevant guidance page",
                  publisher: "gov.uk",
                  publishedDate: null,
                  pageAge: null,
                  retrievedAt: "2026-08-20T00:00:00.000Z",
                  provider: "TAVILY" as const,
                },
              ],
              latencyMs: 10,
              success: true,
              error: null,
            },
          ],
        });
        extractOfficialSourcesMock.mockResolvedValueOnce({
          extracted: [{ url: "https://www.gov.uk/returning-resident-visa", content: "real guidance content" }],
          failed: [],
          latencyMs: 40,
        });
        generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "HIGH" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        await runResearchTask(TOPIC);

        // Both are primary (so both are candidates within the max-3 budget), but the
        // specific page must be selected/extracted ahead of the bare homepage, not after it.
        const [urlsArg] = extractOfficialSourcesMock.mock.calls[0];
        expect(urlsArg[0]).toBe("https://www.gov.uk/returning-resident-visa");
      });

      // Round 4D — the exact real production bug: OFFICIAL_PRIMARY (query 1,
      // pooled first) returns 3 weakly-relevant official results, while
      // OFFICIAL_LEGAL (query 2) finds the actually crucial guidance page.
      // The old flat-pooled-order selection let query 1 starve query 2 of
      // every extraction slot.
      it("TEST 1 (end-to-end): OFFICIAL_LEGAL's result reaches extraction even though OFFICIAL_PRIMARY has 3 candidates of its own", async () => {
        makeSearchAvailable();
        function tavilyResult(url: string, title: string) {
          return {
            title,
            url,
            snippet: title,
            publisher: "example.gov",
            publishedDate: null,
            pageAge: null,
            retrievedAt: "2026-09-15T00:00:00.000Z",
            provider: "TAVILY" as const,
          };
        }
        runResearchSearchMock.mockResolvedValueOnce({
          ok: true,
          provider: "TAVILY" as const,
          executions: [
            {
              provider: "TAVILY" as const,
              query: "official",
              results: [
                tavilyResult("https://petition.parliament.uk/petitions/1", "Petition 1"),
                tavilyResult("https://petition.parliament.uk/petitions/2", "Petition 2"),
                tavilyResult("https://petition.parliament.uk/petitions/3", "Petition 3"),
              ],
              latencyMs: 10,
              success: true,
              error: null,
            },
            {
              provider: "TAVILY" as const,
              query: "legal",
              results: [
                tavilyResult(
                  "https://www.gov.uk/government/publications/returning-residents/lapsing-leave-and-returning-residents-accessible",
                  "Lapsing leave and returning residents",
                ),
              ],
              latencyMs: 10,
              success: true,
              error: null,
            },
            {
              provider: "TAVILY" as const,
              query: "general",
              results: [],
              latencyMs: 10,
              success: true,
              error: null,
            },
          ],
        });
        generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "MEDIUM" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        await runResearchTask(TOPIC);

        const [urlsArg] = extractOfficialSourcesMock.mock.calls[0];
        expect(urlsArg).toContain(
          "https://www.gov.uk/government/publications/returning-residents/lapsing-leave-and-returning-residents-accessible",
        );
        // No extra AI or search calls from adding lane-aware selection.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(2);
        expect(runResearchSearchMock).toHaveBeenCalledTimes(1);
      });
    });

    // Round 4C — Query Planner integration
    describe("Query Planner (RESEARCH_QUERY_PLANNING)", () => {
      // TEST 8
      it("TEST 8: planner failure (generation call itself fails) falls back to the deterministic queries — Research still succeeds", async () => {
        makeSearchAvailable();
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: false,
          data: null,
          error: "planner call failed",
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: null,
          outputTokens: null,
          latencyMs: 1,
        });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        const { result } = await runResearchTask(TOPIC);

        expect(result.ok).toBe(true);
        // TEST 14 — fallback call count: the failed planner attempt + exactly
        // one Sol/analysis call, no third AI attempt.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(2);
        // The deterministic Round 4B queries were what actually got searched.
        const queriesArg = runResearchSearchMock.mock.calls[0][0];
        expect(queriesArg[0].includeDomains).toBeDefined();
      });

      // TEST 9
      it("TEST 9: malformed/schema-invalid planner output falls back to the deterministic queries", async () => {
        makeSearchAvailable();
        // Schema-invalid — missing legal_query entirely. dispatchStructuredAnyProvider's
        // own Zod validation rejects this before it would ever reach the caller as ok:true.
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: false,
          data: null,
          error: "模型输出未通过结构校验：Required",
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        const { result } = await runResearchTask(TOPIC);

        expect(result.ok).toBe(true);
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(2);
      });

      it("falls back to deterministic queries when no model can be resolved for RESEARCH_QUERY_PLANNING at all", async () => {
        makeSearchAvailable();
        // Development Mode off, with a configured default for RESEARCH but
        // NOT for RESEARCH_QUERY_PLANNING — so planning resolution genuinely
        // fails (nothing to fall back on) while the real research call
        // still has its own configured default to use.
        vi.stubEnv("AI_DEVELOPMENT_MODE", "false");
        getModelRoutingConfigMock.mockResolvedValue({ RESEARCH: { provider: "GOOGLE", modelId: "gemini-3.8-flash" } });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        const { result } = await runResearchTask(TOPIC);

        expect(result.ok).toBe(true);
        // No model resolved at all for planning means dispatchStructuredAnyProvider
        // is never even reached for it — only the one real analysis call happens.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(1);
      });

      // TEST 10
      it("TEST 10: RESEARCH_QUERY_PLANNING is an independent TaskType belonging to researcher", async () => {
        const { TASK_TYPE_EMPLOYEE, TASK_TYPES } = await import("./providers/types");
        expect(TASK_TYPES).toContain("RESEARCH_QUERY_PLANNING");
        expect(TASK_TYPE_EMPLOYEE.RESEARCH_QUERY_PLANNING).toBe("researcher");
      });

      it("TEST 10b: honours an ADMIN-configured RESEARCH_QUERY_PLANNING default from model_routing_config, resolved through the real Model Router (not hard-coded)", async () => {
        makeSearchAvailable();
        getModelRoutingConfigMock.mockResolvedValueOnce({
          RESEARCH_QUERY_PLANNING: { provider: "ANTHROPIC", modelId: "claude-sonnet-5" },
        });
        generateAnthropicStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { official_query: "a", legal_query: "b", general_query: "c" },
          error: null,
          provider: "ANTHROPIC",
          modelId: "claude-sonnet-5",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });
        runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "LOW" },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        const { result } = await runResearchTask(TOPIC);

        expect(result.ok).toBe(true);
        // The planner call actually went through the configured ANTHROPIC
        // default, resolved by the real Model Router — not a hard-coded provider.
        expect(generateAnthropicStructuredMock).toHaveBeenCalledTimes(1);
        expect(generateAnthropicStructuredMock.mock.calls[0][0].systemPrompt).not.toContain("政策研究员");
        // Only the real research analysis call goes to Google — the planner call did not.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(1);
      });

      // TEST 15
      it("TEST 15: Topic Discovery (Employee A) never resolves RESEARCH_QUERY_PLANNING", async () => {
        getModelRoutingConfigMock.mockClear();
        runResearchSearchMock.mockResolvedValueOnce({
          ok: true,
          provider: "TAVILY" as const,
          executions: [{ provider: "TAVILY" as const, query: "q", results: [], latencyMs: 1, success: true, error: null }],
        });
        generateGoogleStructuredMock.mockResolvedValueOnce({
          ok: true,
          data: { candidates: [] },
          error: null,
          provider: "GOOGLE",
          modelId: "gemini-3.8-flash",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        });

        await runTopicDiscoveryTask("some keyword");

        // Only ONE generation call for topic discovery itself — no separate
        // query-planning call, confirming A's path is entirely untouched.
        expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(1);
      });
    });

    it("returns a clear failure — no fallback to native — when Tavily is configured but rate-limited", async () => {
      // Search IS configured (a real API key is set) — it's the live call
      // itself that gets rate-limited, which is only discovered by trying.
      // So the Query Planner still runs (it doesn't know search is about
      // to fail) — one AI call, then no second one since search itself failed.
      makeSearchAvailable();
      generateGoogleStructuredMock.mockResolvedValueOnce(PLANNER_SUCCESS);
      runResearchSearchMock.mockResolvedValueOnce({
        ok: false,
        errorCode: "SEARCH_RATE_LIMITED",
        error: "免费搜索服务当前不可用，请稍后重试或由管理员选择其他服务。",
      });

      const { result, searchMeta } = await runResearchTask(TOPIC);

      expect(isRouterResolutionFailure(result)).toBe(true);
      if (isRouterResolutionFailure(result)) {
        expect(result.error).toMatch(/免费搜索服务当前不可用/);
      }
      expect(searchMeta?.success).toBe(false);
      // No fallback to native grounding once a search provider is actually in use.
      expect(runGoogleResearchMock).not.toHaveBeenCalled();
      expect(runAnthropicResearchMock).not.toHaveBeenCalled();
      // Exactly the Query Planner call — no research-analysis call, since search itself failed.
      expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(1);
    });

    it("falls through to the native-grounding path when no search provider is configured at all", async () => {
      // This is the default mock behavior (SEARCH_PROVIDER_NOT_CONFIGURED) —
      // asserted explicitly here as the documented, intentional fallback.
      runGoogleResearchMock.mockResolvedValueOnce({
        ok: true,
        data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.6-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      const { result, searchMeta } = await runResearchTask(TOPIC);

      expect(runGoogleResearchMock).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(searchMeta).toBeNull();
    });

    it("also falls through to native grounding when the Search Router has no FREE provider available at all (SEARCH_ROUTER_UNRESOLVED) — e.g. Brave with no free tier", async () => {
      runResearchSearchMock.mockResolvedValueOnce({
        ok: false,
        errorCode: "SEARCH_ROUTER_UNRESOLVED",
        error: "免费搜索服务当前不可用，请选择其他服务。",
      });
      runGoogleResearchMock.mockResolvedValueOnce({
        ok: true,
        data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.6-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      const { result, searchMeta } = await runResearchTask(TOPIC);

      expect(runGoogleResearchMock).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(searchMeta).toBeNull();
    });
  });
});

const PREVIOUS_PACK = {
  summary: "改革方向已宣布，但正式规则尚未公布。",
  keyFindings: ["政府已宣布改革意向，尚无 Statement of Changes"],
  warnings: "过渡安排未知",
  confidence: "LOW" as const,
  scoreBreakdown: {
    officialSources: { score: 8, max: 20, reason: "缺少官方原始文件" },
    factAccuracy: { score: 15, max: 20, reason: "ok" },
    policyTimeline: { score: 6, max: 20, reason: "过渡安排尚未确认" },
    scopeExceptions: { score: 12, max: 15, reason: "ok" },
    dataReliability: { score: 10, max: 10, reason: "ok" },
    externalSafety: { score: 10, max: 15, reason: "ok" },
  },
};

const CONTENT_SUCCESS = {
  ok: true as const,
  data: {
    summary: "s",
    key_findings: ["f"],
    source_references: ["S1"],
    warnings: "",
    confidence: "MEDIUM" as const,
    topic_revision_suggestion: null,
  },
  error: null,
  provider: "GOOGLE" as const,
  modelId: "gemini-3.8-flash",
  inputTokens: 10,
  outputTokens: 10,
  latencyMs: 50,
};

const AUDIT_SUCCESS = {
  ok: true as const,
  data: {
    scores: {
      official_sources: { score: 18, reason: "r" },
      fact_accuracy: { score: 18, reason: "r" },
      policy_timeline: { score: 16, reason: "r" },
      scope_exceptions: { score: 12, reason: "r" },
      data_reliability: { score: 9, reason: "r" },
      external_safety: { score: 13, reason: "r" },
    },
  },
  error: null,
  provider: "GOOGLE" as const,
  modelId: "gemini-3.8-flash",
  inputTokens: 5,
  outputTokens: 5,
  latencyMs: 20,
};

/**
 * B｜政策研究员's "研究优化" mode (docs/ai-workflows.md "研究优化") — reuses
 * the exact same Search Router → extraction → Model Router pipeline
 * runResearchTask uses, with deliberate differences covered here: no
 * native-grounding fallback, no Query Planner call, and — the live audit
 * fix (2026-09) — TWO separate model calls (CONTENT then independent
 * AUDIT), never one call that both fixes and grades its own work. Both
 * default to the same GOOGLE dev-mode model here (no configured default
 * for either RESEARCH or RESEARCH_AUDIT in these tests), so tests queue
 * two `generateGoogleStructuredMock` values, in call order.
 */
describe("runResearchOptimizationTask", () => {
  const SEARCH_SUCCESS = {
    ok: true as const,
    provider: "TAVILY" as const,
    executions: [
      {
        provider: "TAVILY" as const,
        query: "test",
        results: [
          {
            title: "GOV.UK — official guidance",
            url: "https://www.gov.uk/official-guidance",
            snippet: "Official guidance.",
            publisher: "gov.uk",
            publishedDate: null,
            pageAge: null,
            retrievedAt: "2026-09-20T00:00:00.000Z",
            provider: "TAVILY" as const,
          },
        ],
        latencyMs: 90,
        success: true,
        error: null,
      },
    ],
  };

  function makeSearchAvailable() {
    resolveSearchProviderMock.mockReturnValueOnce({ ok: true, provider: { provider: "TAVILY" } });
    isSearchProviderConfiguredMock.mockReturnValueOnce(true);
  }

  it("returns a clear resolution failure without ever calling the Search Router when no search provider is configured", async () => {
    // beforeEach's default already reports "not configured" — optimization
    // has no native-grounding fallback (unlike runResearchTask), so this
    // must fail closed instead of silently running an untargeted search.
    const { result, searchMeta, auditUsage } = await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    expect(result.ok).toBe(false);
    expect(result.provider).toBeNull();
    expect(searchMeta).toBeNull();
    expect(auditUsage).toBeNull();
    expect(runResearchSearchMock).not.toHaveBeenCalled();
  });

  it("runs targeted search + CONTENT + independent AUDIT end to end, scoring from the audit call only", async () => {
    makeSearchAvailable();
    runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ...CONTENT_SUCCESS,
      data: {
        ...CONTENT_SUCCESS.data,
        topic_revision_suggestion: { title: "新标题", question: "新问题", reason: "原标题过于绝对" },
      },
    });
    generateGoogleStructuredMock.mockResolvedValueOnce(AUDIT_SUCCESS);

    const { result, auditUsage } = await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.sources).toHaveLength(1);
      expect(result.data.sources[0].url).toBe("https://www.gov.uk/official-guidance");
      expect(result.data.suggestedTopicRevision).toEqual({
        title: "新标题",
        question: "新问题",
        reason: "原标题过于绝对",
      });
      // Score comes from AUDIT_SUCCESS's numbers, not anything the content
      // call could have supplied (it has no scores field to supply at all).
      expect(result.data.scoreBreakdown.officialSources.score).toBe(18);
      expect(result.data.scoreTotal).toBe(18 + 18 + 16 + 12 + 9 + 13);
    }
    expect(auditUsage).toEqual({
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 5,
      outputTokens: 5,
      latencyMs: 20,
      ok: true,
      error: null,
    });
  });

  it("dispatches exactly two generation calls — content then audit — never a single self-scoring call", async () => {
    makeSearchAvailable();
    runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce(CONTENT_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce(AUDIT_SUCCESS);

    await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(2);
    expect(generateGoogleStructuredMock.mock.calls[1][0]).toMatchObject({ maxTokens: 8000 });
  });

  it("never shows the audit call the previous round's score_total, score_breakdown, or reasons", async () => {
    makeSearchAvailable();
    runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce(CONTENT_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce(AUDIT_SUCCESS);

    await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    const auditCallArgs = generateGoogleStructuredMock.mock.calls[1][0];
    expect(auditCallArgs.userMessage).not.toContain("缺少官方原始文件"); // PREVIOUS_PACK's own dimension reason
    expect(auditCallArgs.userMessage).not.toMatch(/8\/20/); // PREVIOUS_PACK's own dimension score
  });

  it("fails the whole optimization (previous pack untouched) when the independent audit call itself fails", async () => {
    makeSearchAvailable();
    runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce(CONTENT_SUCCESS);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "审核模型超时",
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: null,
      outputTokens: null,
      latencyMs: 5,
    });

    const { result, auditUsage } = await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/独立复核评分失败/);
    expect(auditUsage?.ok).toBe(false);
    expect(auditUsage?.error).toMatch(/审核模型超时/);
  });

  it("propagates a real Search Router failure as a resolution failure — no fallback to native grounding", async () => {
    resolveSearchProviderMock.mockReturnValueOnce({ ok: true, provider: { provider: "TAVILY" } });
    isSearchProviderConfiguredMock.mockReturnValueOnce(true);
    runResearchSearchMock.mockResolvedValueOnce({
      ok: false,
      errorCode: "SEARCH_RATE_LIMITED",
      error: "Tavily 已被限流。",
    });

    const { result } = await runResearchOptimizationTask(TOPIC, PREVIOUS_PACK);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/限流/);
    expect(generateGoogleStructuredMock).not.toHaveBeenCalled();
    expect(runGoogleResearchMock).not.toHaveBeenCalled();
  });
});

describe("runContentTask", () => {
  it("dispatches VIDEO_WRITING to the resolved Google provider and applies grounding to the result", async () => {
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: {
        title: "标题",
        hook: "钩子",
        cover_text: "封面",
        target_duration_seconds: 90,
        full_script: "口播",
        evidence_visuals: [],
        cta: "cta",
        publish_title: "发布标题",
        publish_caption: "发布文案",
        source_references: ["S1", "S99"],
        expert_review_notes: [],
      },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.6-flash",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
    });
    const input = {
      ...EVIDENCE_INPUT,
      sources: [
        {
          id: "src-1",
          research_pack_id: "pack-1",
          title: "GOV.UK",
          url: "https://www.gov.uk/x",
          note: "",
          page_age: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    const result = await runContentTask("VIDEO_WRITING", input);
    expect(generateGoogleStructuredMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok && result.data && "source_references" in result.data) {
      // S1 resolves to the real source id, S99 (fabricated) is dropped —
      // the same grounding guarantee the Anthropic path applies inline.
      expect(result.data.source_references).toEqual(["src-1"]);
    }
  });

  it("dispatches to Anthropic when resolved, without touching Google/Groq/OpenRouter", async () => {
    runAnthropicContentTaskMock.mockResolvedValueOnce({
      ok: true,
      data: { title: "标题", source_references: [], expert_review_notes: [] },
      error: null,
      provider: "ANTHROPIC",
      modelId: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await runContentTask("VIDEO_WRITING", EVIDENCE_INPUT, { provider: "ANTHROPIC", modelId: "claude-opus-5" });
    // Router must pass the resolved modelId through, not leave it to a hardcoded default (Round 2 fix).
    expect(runAnthropicContentTaskMock).toHaveBeenCalledWith("VIDEO_WRITING", EVIDENCE_INPUT, null, "claude-opus-5");
    expect(generateGoogleStructuredMock).not.toHaveBeenCalled();
    expect(generateGroqStructuredMock).not.toHaveBeenCalled();
  });

  it("dispatches to Groq when explicitly overridden", async () => {
    generateGroqStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: {
        title: "x",
        hook: "h",
        cover_text: "c",
        target_duration_seconds: 60,
        full_script: "script",
        evidence_visuals: [],
        cta: "cta",
        publish_title: "pt",
        publish_caption: "pc",
        source_references: [],
        expert_review_notes: [],
      },
      error: null,
      provider: "GROQ",
      modelId: "openai/gpt-oss-120b",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const result = await runContentTask("VIDEO_WRITING", EVIDENCE_INPUT, {
      provider: "GROQ",
      modelId: "openai/gpt-oss-120b",
    });
    expect(generateGroqStructuredMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe("runWechatFullArticleTask", () => {
  const outline = { title_options: ["a", "b", "c"], summary: "s", detailed_outline: [], key_claims: [] };

  it("dispatches to Anthropic when resolved", async () => {
    runAnthropicWechatFullArticleMock.mockResolvedValueOnce({
      ok: true,
      data: { title: "完整文章", full_article: "正文", source_references: [], expert_review_notes: [] },
      error: null,
      provider: "ANTHROPIC",
      modelId: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await runWechatFullArticleTask(
      { ...EVIDENCE_INPUT, outline },
      { provider: "ANTHROPIC", modelId: "claude-opus-5" },
    );
    // Router must pass the resolved modelId through, not leave it to a hardcoded default (Round 2 fix).
    expect(runAnthropicWechatFullArticleMock).toHaveBeenCalledWith({ ...EVIDENCE_INPUT, outline }, null, "claude-opus-5");
  });

  it("dispatches to a non-Anthropic provider and applies grounding", async () => {
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { title: "完整文章", full_article: "正文", source_references: [], expert_review_notes: [] },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.6-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const result = await runWechatFullArticleTask({ ...EVIDENCE_INPUT, outline });
    expect(generateGoogleStructuredMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

// Round 3A — A｜选题策划员 real-failure fixes: keyword must actually reach
// the model, and an invalid source_label must be filtered rather than
// trusted or allowed to fail the whole task.
describe("runTopicDiscoveryTask", () => {
  const REAL_FAILURE_KEYWORD = "英国永居申请费£3,226，Home Office处理成本为什么只有约£310？";

  function searchResult(label: string, title: string, snippet: string) {
    return {
      title,
      url: `https://example.com/${label}`,
      snippet,
      publisher: "example.com",
      publishedDate: null,
      pageAge: null,
      retrievedAt: "2026-09-15T00:00:00.000Z",
      provider: "TAVILY" as const,
    };
  }

  const THREE_RESULT_SEARCH = {
    ok: true as const,
    provider: "TAVILY" as const,
    executions: [
      {
        provider: "TAVILY" as const,
        query: REAL_FAILURE_KEYWORD,
        results: [
          searchResult("N1", "Home Office immigration fees: processing costs", "processing cost detail"),
          searchResult("N2", "十年永居：离境180天规则详解", "absence rules for long residence"),
          searchResult("N3", "学生签证资金要求最新变化", "student visa funds requirement"),
        ],
        latencyMs: 100,
        success: true,
        error: null,
      },
    ],
  };

  it("surfaces the user's original keyword to the model, not just the search results (the real bug: the model never saw it before)", async () => {
    runResearchSearchMock.mockResolvedValueOnce(THREE_RESULT_SEARCH);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { candidates: [] },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    await runTopicDiscoveryTask(REAL_FAILURE_KEYWORD);

    const call = generateGoogleStructuredMock.mock.calls[0][0];
    expect(call.userMessage).toContain(REAL_FAILURE_KEYWORD);
  });

  it("builds directed-search queries from the keyword (not the generic monthly news sweep) and passes them to the Search Router", async () => {
    runResearchSearchMock.mockResolvedValueOnce(THREE_RESULT_SEARCH);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { candidates: [] },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    await runTopicDiscoveryTask(REAL_FAILURE_KEYWORD);

    const queriesArg = runResearchSearchMock.mock.calls[0][0] as string[];
    expect(queriesArg[0]).toBe(REAL_FAILURE_KEYWORD);
    for (const q of queriesArg) expect(q).not.toContain("UK visa rules update");
  });

  // TEST 7 (Round 4B) — Employee A's search behavior must not change at
  // all: still plain strings, never the new { query, includeDomains }
  // shape B's official-first search introduced.
  it("TEST 7: still passes plain string queries to the Search Router, not the includeDomains object shape B now uses", async () => {
    runResearchSearchMock.mockResolvedValueOnce(THREE_RESULT_SEARCH);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { candidates: [] },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    await runTopicDiscoveryTask(REAL_FAILURE_KEYWORD);

    const queriesArg = runResearchSearchMock.mock.calls[0][0] as unknown[];
    for (const q of queriesArg) expect(typeof q).toBe("string");
  });

  it("filters out a candidate with a hallucinated source_label (N99) while keeping valid ones — one bad label doesn't fail the whole task", async () => {
    runResearchSearchMock.mockResolvedValueOnce(THREE_RESULT_SEARCH);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: {
        candidates: [
          {
            title: "永居收费为什么可能远高于处理成本？",
            question: "q",
            business: "永居 / ILR",
            audience: "准备申请ILR的人",
            content_pillar: "myth_busting",
            priority: "HIGH",
            source_label: "N1",
            reason: "r",
          },
          {
            title: "fabricated",
            question: "q",
            business: "b",
            audience: "a",
            content_pillar: null,
            priority: "LOW",
            source_label: "N99",
            reason: "r",
          },
        ],
      },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    const result = await runTopicDiscoveryTask(REAL_FAILURE_KEYWORD);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.candidates).toHaveLength(1);
      expect(result.data.candidates[0].source_label).toBe("N1");
    }
  });

  it("returns zero candidates as-is when the model finds nothing strongly relevant — does not force a fallback recommendation", async () => {
    runResearchSearchMock.mockResolvedValueOnce(THREE_RESULT_SEARCH);
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { candidates: [] },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.8-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    const result = await runTopicDiscoveryTask(REAL_FAILURE_KEYWORD);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) expect(result.data.candidates).toEqual([]);
  });

  // Round 3C — AUTO-discovery (no keyword) now searches 5 editorial lanes;
  // the manifest Terra actually sees must be pooled round-robin (not lane
  // 1's results dominating) and de-duplicated, and it must still cost
  // exactly one AI call.
  describe("AUTO-discovery: 5-lane pooling (Round 3C)", () => {
    function laneResult(url: string, title: string) {
      return {
        title,
        url,
        snippet: title,
        publisher: "example.com",
        publishedDate: null,
        pageAge: null,
        retrievedAt: "2026-09-15T00:00:00.000Z",
        provider: "TAVILY" as const,
      };
    }

    function dummyCandidate() {
      return {
        title: "t",
        question: "q",
        business: "b",
        audience: "a",
        content_pillar: null,
        priority: "MEDIUM",
        source_label: "N1",
        reason: "r",
      };
    }

    it("TEST 15: pools all 5 lanes into the manifest Terra sees, deduplicated, in exactly one AI call", async () => {
      runResearchSearchMock.mockResolvedValueOnce({
        ok: true,
        provider: "TAVILY" as const,
        executions: [
          {
            provider: "TAVILY" as const,
            query: "policy lane",
            results: [
              laneResult("https://www.gov.uk/policy-1", "Policy change 1"),
              laneResult("https://www.gov.uk/policy-2", "Policy change 2"),
              laneResult("https://www.gov.uk/policy-3", "Policy change 3"),
            ],
            latencyMs: 10,
            success: true,
            error: null,
          },
          {
            provider: "TAVILY" as const,
            query: "status lane",
            results: [laneResult("https://www.gov.uk/status-1", "eVisa status issue")],
            latencyMs: 10,
            success: true,
            error: null,
          },
          {
            provider: "TAVILY" as const,
            query: "routes lane",
            results: [laneResult("https://www.gov.uk/route-1", "Student visa route change")],
            latencyMs: 10,
            success: true,
            error: null,
          },
          {
            provider: "TAVILY" as const,
            query: "incidents lane",
            results: [laneResult("https://news.example.com/incident-1", "Airport boarding incident")],
            latencyMs: 10,
            success: true,
            error: null,
          },
          {
            provider: "TAVILY" as const,
            query: "fees lane",
            // Same URL as the policy lane's first result — must be deduped.
            results: [laneResult("https://www.gov.uk/policy-1", "Policy change 1 (duplicate find)")],
            latencyMs: 10,
            success: true,
            error: null,
          },
        ],
      });
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { candidates: [] },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.8-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      await runTopicDiscoveryTask();

      // Exactly one AI call for AUTO-discovery — no query planner, no reranker.
      expect(generateGoogleStructuredMock).toHaveBeenCalledTimes(1);

      const call = generateGoogleStructuredMock.mock.calls[0][0];
      // Every lane's content reached the manifest, not just lane 1's.
      expect(call.userMessage).toContain("eVisa status issue");
      expect(call.userMessage).toContain("Student visa route change");
      expect(call.userMessage).toContain("Airport boarding incident");
      // The duplicate URL from the fees lane did not create a second entry.
      expect(call.userMessage).not.toContain("Policy change 1 (duplicate find)");

      // Round-robin: lane 2's (status) result must appear before lane 1's
      // (policy) SECOND result — proving lane 1 didn't get flattened/pooled first.
      const statusIndex = call.userMessage.indexOf("eVisa status issue");
      const policy2Index = call.userMessage.indexOf("Policy change 2");
      expect(statusIndex).toBeGreaterThan(-1);
      expect(policy2Index).toBeGreaterThan(-1);
      expect(statusIndex).toBeLessThan(policy2Index);
    });

    // Round 3D — TEST 16: with sufficient evidence, the REAL schema passed
    // to the (real) provider call must be the hard 5-6 one, not the old
    // shared max(6)-only schema that let 2 candidates through.
    it("TEST 16: with evidence spread across >=3 lanes and >=5 unique results, the dispatched schema requires a floor of 5", async () => {
      runResearchSearchMock.mockResolvedValueOnce({
        ok: true,
        provider: "TAVILY" as const,
        executions: [
          { provider: "TAVILY" as const, query: "policy", results: [laneResult("https://a.com/1", "a1"), laneResult("https://a.com/2", "a2")], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "status", results: [laneResult("https://b.com/1", "b1")], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "routes", results: [laneResult("https://c.com/1", "c1")], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "incidents", results: [laneResult("https://d.com/1", "d1")], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "fees", results: [], latencyMs: 1, success: true, error: null },
        ],
      });
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { candidates: [] },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.8-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      await runTopicDiscoveryTask();

      const dispatchedSchema = generateGoogleStructuredMock.mock.calls[0][0].schema;
      // 4 candidates must be rejected by whatever schema was actually dispatched — proving it's the hard floor-of-5 schema.
      expect(dispatchedSchema.safeParse({ candidates: Array.from({ length: 4 }, dummyCandidate) }).success).toBe(false);
      expect(dispatchedSchema.safeParse({ candidates: Array.from({ length: 5 }, dummyCandidate) }).success).toBe(true);
    });

    it("falls back to the sparse 0-6 schema when evidence is too thin — never forcing the model to fabricate", async () => {
      runResearchSearchMock.mockResolvedValueOnce({
        ok: true,
        provider: "TAVILY" as const,
        executions: [
          { provider: "TAVILY" as const, query: "policy", results: [laneResult("https://a.com/1", "a1")], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "status", results: [], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "routes", results: [], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "incidents", results: [], latencyMs: 1, success: true, error: null },
          { provider: "TAVILY" as const, query: "fees", results: [], latencyMs: 1, success: true, error: null },
        ],
      });
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { candidates: [] },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.8-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      await runTopicDiscoveryTask();

      const call = generateGoogleStructuredMock.mock.calls[0][0];
      // A schema allowing 0 candidates was used, and the honesty note reached the model.
      expect(call.schema.safeParse({ candidates: [] }).success).toBe(true);
      expect(call.userMessage).toContain("不要为了凑数编造");
    });

    // TEST 3 (router-level regression) — DIRECTED never uses the AUTO min(5) schema.
    it("directed search never gets the AUTO min(5) schema, even when the search happens to return abundant multi-lane-shaped results", async () => {
      runResearchSearchMock.mockResolvedValueOnce({
        ok: true,
        provider: "TAVILY" as const,
        executions: [
          { provider: "TAVILY" as const, query: "q", results: Array.from({ length: 10 }, (_, i) => laneResult(`https://a.com/${i}`, `a${i}`)), latencyMs: 1, success: true, error: null },
        ],
      });
      generateGoogleStructuredMock.mockResolvedValueOnce({
        ok: true,
        data: { candidates: [] },
        error: null,
        provider: "GOOGLE",
        modelId: "gemini-3.8-flash",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });

      await runTopicDiscoveryTask("英国永居申请费£3,226");

      const dispatchedSchema = generateGoogleStructuredMock.mock.calls[0][0].schema;
      expect(dispatchedSchema.safeParse({ candidates: Array.from({ length: 4 }, dummyCandidate) }).success).toBe(false);
      expect(dispatchedSchema.safeParse({ candidates: [] }).success).toBe(true);
    });
  });
});
