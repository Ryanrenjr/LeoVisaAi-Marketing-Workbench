// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { runResearchAgentMock, generateVideoMock, generateXhsMock, generateWechatOutlineMock, generateWechatFullMock } =
  vi.hoisted(() => ({
    runResearchAgentMock: vi.fn(),
    generateVideoMock: vi.fn(),
    generateXhsMock: vi.fn(),
    generateWechatOutlineMock: vi.fn(),
    generateWechatFullMock: vi.fn(),
  }));

vi.mock("../research-agent", () => ({ runResearchAgent: runResearchAgentMock }));
vi.mock("../content-agent", () => ({
  generateVideoChannelContent: generateVideoMock,
  generateXiaohongshuContent: generateXhsMock,
  generateWechatOutline: generateWechatOutlineMock,
  generateWechatFullArticle: generateWechatFullMock,
}));

const { runAnthropicResearch, runAnthropicContentTask, runAnthropicWechatFullArticle, parseStructuredResponse } = await import(
  "./anthropic-provider"
);

const TOPIC = { title: "t", question: "q", business: "b", audience: "a" };
const EVIDENCE_INPUT = {
  topic: { title: "t", question: "q", business: "b", audience: "a", content_pillar: null },
  researchPack: { summary: "s", key_findings: [], warnings: "", confidence: "HIGH" as const },
  sources: [],
};

function structuredMessage(content: string, parsedOutput?: unknown) {
  return {
    content: content ? [{ type: "text", text: content, citations: null }] : [],
    parsed_output: parsedOutput,
    stop_reason: "end_turn",
  } as never;
}

describe("parseStructuredResponse", () => {
  const schema = z.object({ title: z.string() });

  it("uses the SDK parsed output when available", () => {
    expect(parseStructuredResponse(structuredMessage("", { title: "SDK" }), schema)).toEqual({ title: "SDK" });
  });

  it("recovers valid JSON text when the SDK leaves parsed_output empty", () => {
    expect(parseStructuredResponse(structuredMessage('{"title":"文本"}', null), schema)).toEqual({ title: "文本" });
  });

  it("recovers JSON wrapped in a markdown fence", () => {
    expect(parseStructuredResponse(structuredMessage('```json\n{"title":"围栏"}\n```', null), schema)).toEqual({
      title: "围栏",
    });
  });

  it("reports the stop reason when neither parsed nor text output is usable", () => {
    expect(() => parseStructuredResponse(structuredMessage("not json", null), schema)).toThrow(/end_turn/);
  });
});

describe("runAnthropicResearch", () => {
  it("normalizes a successful research-agent.ts result into AIExecutionResult", async () => {
    runResearchAgentMock.mockResolvedValueOnce({
      ok: true,
      pack: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
      modelAlias: "claude-opus-5",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1000,
    });
    const result = await runAnthropicResearch(TOPIC);
    expect(result).toEqual({
      ok: true,
      data: { summary: "s", keyFindings: [], sources: [], warnings: "", confidence: "HIGH" },
      error: null,
      provider: "ANTHROPIC",
      modelId: "claude-opus-5",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1000,
    });
  });

  it("normalizes a failure result, keeping data null", async () => {
    runResearchAgentMock.mockResolvedValueOnce({
      ok: false,
      error: "ANTHROPIC_API_KEY 未配置，无法运行研究。",
      modelAlias: "claude-opus-5",
      inputTokens: null,
      outputTokens: null,
      latencyMs: 5,
    });
    const result = await runAnthropicResearch(TOPIC);
    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(result.provider).toBe("ANTHROPIC");
  });
});

describe("runAnthropicContentTask", () => {
  it("dispatches VIDEO_WRITING to generateVideoChannelContent", async () => {
    generateVideoMock.mockResolvedValueOnce({
      ok: true,
      content: { title: "标题" },
      modelAlias: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const result = await runAnthropicContentTask("VIDEO_WRITING", EVIDENCE_INPUT);
    expect(generateVideoMock).toHaveBeenCalledWith(EVIDENCE_INPUT, undefined, undefined);
    expect(generateXhsMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "标题" });
  });

  it("dispatches XIAOHONGSHU_WRITING to generateXiaohongshuContent", async () => {
    generateXhsMock.mockResolvedValueOnce({
      ok: true,
      content: { title: "x" },
      modelAlias: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await runAnthropicContentTask("XIAOHONGSHU_WRITING", EVIDENCE_INPUT);
    expect(generateXhsMock).toHaveBeenCalledWith(EVIDENCE_INPUT, undefined, undefined);
  });

  it("dispatches WECHAT_WRITING to generateWechatOutline", async () => {
    generateWechatOutlineMock.mockResolvedValueOnce({
      ok: true,
      content: { title: "w" },
      modelAlias: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await runAnthropicContentTask("WECHAT_WRITING", EVIDENCE_INPUT);
    expect(generateWechatOutlineMock).toHaveBeenCalledWith(EVIDENCE_INPUT, undefined, undefined);
  });
});

describe("runAnthropicWechatFullArticle", () => {
  it("delegates to generateWechatFullArticle and normalizes the result", async () => {
    generateWechatFullMock.mockResolvedValueOnce({
      ok: true,
      content: { title: "完整文章" },
      modelAlias: "claude-opus-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const input = {
      ...EVIDENCE_INPUT,
      outline: { title_options: ["a", "b", "c"], summary: "s", detailed_outline: [], key_claims: [] },
    };
    const result = await runAnthropicWechatFullArticle(input);
    expect(generateWechatFullMock).toHaveBeenCalledWith(input, undefined, undefined);
    expect(result.data).toEqual({ title: "完整文章" });
  });
});
