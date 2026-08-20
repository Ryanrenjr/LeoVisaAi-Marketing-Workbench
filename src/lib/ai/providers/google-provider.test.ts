// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. @google/genai is fully
// mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

const { runGoogleResearch, generateGoogleStructured, isGoogleConfigured } = await import("./google-provider");

beforeEach(() => {
  generateContentMock.mockReset();
  vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const TOPIC = {
  title: "老永居离境超过2年，身份还在吗？",
  question: "老永居离境超过2年，身份还在吗？",
  business: "永居 / ILR",
  audience: "持老式永居的申请人",
};

describe("isGoogleConfigured", () => {
  it("reports configured when GOOGLE_AI_API_KEY is set", () => {
    expect(isGoogleConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    expect(isGoogleConfigured()).toBe(false);
  });
});

describe("runGoogleResearch", () => {
  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    const result = await runGoogleResearch(TOPIC, "gemini-3.6-flash");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GOOGLE_AI_API_KEY/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("maps grounding chunks into real sources and grounds the claimed pack against them", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "摘要",
        key_findings: ["发现一"],
        sources: [
          { title: "GOV.UK", url: "https://www.gov.uk/real", note: "官方" },
          { title: "编造的来源", url: "https://fake.example/not-real", note: "" },
        ],
        warnings: "",
        confidence: "HIGH",
      }),
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://www.gov.uk/real", title: "GOV.UK" } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const result = await runGoogleResearch(TOPIC, "gemini-3.6-flash");
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("GOOGLE");
    expect(result.data?.sources).toHaveLength(1);
    expect(result.data?.sources[0].url).toBe("https://www.gov.uk/real");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it("returns an error when the model gives no text", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "", candidates: [] });
    const result = await runGoogleResearch(TOPIC, "gemini-3.6-flash");
    expect(result.ok).toBe(false);
  });
});

describe("generateGoogleStructured", () => {
  const schema = z.object({ title: z.string(), count: z.number() });

  it("fails fast when not configured", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    const result = await generateGoogleStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gemini-3.6-flash",
    });
    expect(result.ok).toBe(false);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("parses and validates JSON output against the given Zod schema", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({ title: "标题", count: 3 }),
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const result = await generateGoogleStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gemini-3.6-flash",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "标题", count: 3 });
  });

  it("fails when the model output doesn't match the schema", async () => {
    generateContentMock.mockResolvedValueOnce({ text: JSON.stringify({ title: "标题" }) });
    const result = await generateGoogleStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gemini-3.6-flash",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/校验/);
  });

  it("fails when the model output isn't valid JSON", async () => {
    generateContentMock.mockResolvedValueOnce({ text: "not json" });
    const result = await generateGoogleStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gemini-3.6-flash",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/JSON/);
  });
});
