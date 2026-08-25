// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. The Anthropic SDK is
// fully mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "APIError";
    }
  }
  class MockAnthropic {
    messages = { parse: parseMock };
  }
  return { default: Object.assign(MockAnthropic, { APIError: MockAPIError }) };
});

const {
  generateVideoChannelContent,
  generateXiaohongshuContent,
  generateXiaohongshuPagesPlan,
  generateWechatOutline,
  generateWechatFullArticle,
  isContentAgentConfigured,
  contentAgentModelAlias,
} = await import("./content-agent");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const SOURCES = [
  {
    id: "src-1",
    research_pack_id: "pack-1",
    title: "GOV.UK",
    url: "https://www.gov.uk/example",
    note: "官方说明",
    page_age: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const EVIDENCE_INPUT = {
  topic: {
    title: "老永居离境超过2年，身份还在吗？",
    question: "老永居离境超过2年，身份还在吗？",
    business: "永居 / ILR",
    audience: "持老式永居的申请人",
    content_pillar: "myth_busting" as const,
  },
  researchPack: {
    summary: "研究摘要",
    key_findings: ["发现一"],
    warnings: "",
    confidence: "HIGH" as const,
  },
  sources: SOURCES,
};

function mockParseOnce(parsed_output: unknown, usage = { input_tokens: 1000, output_tokens: 500 }) {
  parseMock.mockResolvedValueOnce({ parsed_output, usage });
}

beforeEach(() => {
  parseMock.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isContentAgentConfigured / contentAgentModelAlias", () => {
  it("reports configured when ANTHROPIC_API_KEY is set", () => {
    expect(isContentAgentConfigured()).toBe(true);
  });

  it("reports not configured when unset", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isContentAgentConfigured()).toBe(false);
  });

  it("defaults the model alias to claude-opus-5", () => {
    expect(contentAgentModelAlias()).toBe("claude-opus-5");
  });
});

describe("generateVideoChannelContent", () => {
  const validVideo = {
    title: "标题",
    hook: "钩子",
    cover_text: "封面字",
    target_duration_seconds: 90,
    full_script: "完整口播内容",
    evidence_visuals: ["画面建议"],
    cta: "行动号召",
    publish_title: "发布标题",
    publish_caption: "发布文案",
    source_references: ["S1"],
    expert_review_notes: [],
  };

  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("returns grounded content on success, resolving S1 to the real source id", async () => {
    mockParseOnce(validVideo);
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.content.source_references).toEqual(["src-1"]);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.modelAlias).toBe("claude-opus-5");
  });

  it("drops a fabricated source label end-to-end", async () => {
    mockParseOnce({ ...validVideo, source_references: ["S1", "S99"] });
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.content.source_references).toEqual(["src-1"]);
    expect(result.content.expert_review_notes.some((n) => n.claim === "来源引用")).toBe(true);
  });

  it("flags forbidden hype language into expert_review_notes without failing generation", async () => {
    mockParseOnce({ ...validVideo, full_script: "窗口马上关闭，赶紧申请！" });
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const claims = result.content.expert_review_notes.map((n) => n.claim);
    expect(claims).toEqual(expect.arrayContaining(["窗口马上关闭", "赶紧申请"]));
  });

  it("rejects unsupported/malformed AI output (fails schema validation, does not save)", async () => {
    mockParseOnce({ ...validVideo, target_duration_seconds: 99999 });
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/校验/);
  });

  it("fails when the SDK returns a null parsed_output", async () => {
    mockParseOnce(null);
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/解析/);
  });

  it("formats an Anthropic API error with its status code", async () => {
    const MockAPIError = Anthropic.APIError as unknown as new (status: number, message: string) => Error;
    parseMock.mockImplementationOnce(() => {
      throw new MockAPIError(529, "overloaded");
    });
    const result = await generateVideoChannelContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/529/);
      expect(result.error).toMatch(/overloaded/);
    }
  });
});

describe("generateXiaohongshuContent", () => {
  it("returns grounded content on success", async () => {
    mockParseOnce({
      title_options: ["A", "B", "C"],
      cover_title: "封面",
      caption: "正文",
      keywords: ["关键词"],
      source_references: ["S1"],
      expert_review_notes: [],
    });
    const result = await generateXiaohongshuContent(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.cover_title).toBe("封面");
  });
});

describe("generateXiaohongshuPagesPlan", () => {
  it("returns grounded content on success", async () => {
    mockParseOnce({
      pages: Array.from({ length: 6 }, (_, i) => `第${i + 1}页`),
      source_references: ["S1"],
      expert_review_notes: [],
    });
    const result = await generateXiaohongshuPagesPlan(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.pages).toHaveLength(6);
  });
});

describe("generateWechatOutline", () => {
  it("returns grounded content on success", async () => {
    mockParseOnce({
      title_options: ["A", "B", "C"],
      summary: "摘要",
      detailed_outline: ["第一部分"],
      key_claims: ["主张一"],
      faq: [{ question: "问题", answer: "答案" }],
      source_references: [],
      expert_review_notes: [],
    });
    const result = await generateWechatOutline(EVIDENCE_INPUT);
    expect(result.ok).toBe(true);
  });
});

describe("generateWechatFullArticle", () => {
  it("builds on the given outline and returns grounded content", async () => {
    mockParseOnce({
      title: "完整文章标题",
      full_article: "完整文章正文内容",
      source_references: ["S1"],
      expert_review_notes: [],
    });
    const result = await generateWechatFullArticle({
      ...EVIDENCE_INPUT,
      outline: {
        title_options: ["A", "B", "C"],
        summary: "摘要",
        detailed_outline: ["第一部分"],
        key_claims: ["主张一"],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.source_references).toEqual(["src-1"]);

    // The outline's content should have been included in the prompt sent to the model.
    const call = parseMock.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("第一部分");
  });
});
