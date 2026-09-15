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
vi.mock("../search/router", () => ({ runResearchSearch: runResearchSearchMock }));

const {
  runResearchTask,
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

    it("runs Search + Gemini analysis end to end and grounds the result against real search results", async () => {
      runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
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
      runResearchSearchMock.mockResolvedValueOnce(SEARCH_SUCCESS);
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

    it("returns a clear failure — no fallback to native — when Tavily is configured but rate-limited", async () => {
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
      expect(generateGoogleStructuredMock).not.toHaveBeenCalled();
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
});
