// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. groq-sdk is fully
// mocked below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const { generateGroqStructured, isGroqConfigured } = await import("./groq-provider");

beforeEach(() => {
  createMock.mockReset();
  vi.stubEnv("GROQ_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isGroqConfigured", () => {
  it("reports configured when GROQ_API_KEY is set", () => {
    expect(isGroqConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isGroqConfigured()).toBe(false);
  });
});

describe("generateGroqStructured", () => {
  const schema = z.object({ title: z.string() });

  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const result = await generateGroqStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "openai/gpt-oss-120b",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GROQ_API_KEY/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("parses and validates the JSON-mode response", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: "标题" }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
    const result = await generateGroqStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "openai/gpt-oss-120b",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "标题" });
    expect(result.provider).toBe("GROQ");
    expect(result.inputTokens).toBe(20);
  });

  it("fails when output doesn't validate against the schema", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({}) } }] });
    const result = await generateGroqStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "openai/gpt-oss-120b",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/校验/);
  });

  it("formats a thrown SDK error", async () => {
    createMock.mockImplementationOnce(() => {
      throw new Error("rate limited");
    });
    const result = await generateGroqStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "openai/gpt-oss-120b",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/);
  });
});
