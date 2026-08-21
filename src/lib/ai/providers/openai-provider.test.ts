// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. global fetch is mocked
// below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { generateOpenAIStructured, generateOpenAIImage, isOpenAIConfigured } = await import("./openai-provider");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isOpenAIConfigured", () => {
  it("reports configured when OPENAI_API_KEY is set", () => {
    expect(isOpenAIConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isOpenAIConfigured()).toBe(false);
  });
});

describe("generateOpenAIStructured", () => {
  const schema = z.object({ title: z.string() });

  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateOpenAIStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gpt-5-mini",
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses and validates a successful JSON response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ title: "标题" }) } }],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      }),
    });
    const result = await generateOpenAIStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gpt-5-mini",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "标题" });
    expect(result.provider).toBe("OPENAI");
  });

  it("fails on a non-2xx HTTP response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" });
    const result = await generateOpenAIStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gpt-5-mini",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
  });

  it("fails when output doesn't validate against the schema", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({}) } }] }),
    });
    const result = await generateOpenAIStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "gpt-5-mini",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/校验/);
  });
});

describe("generateOpenAIImage", () => {
  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateOpenAIImage({ prompt: "a cat", modelId: "gpt-image-1", size: "1024x1024" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns base64 image data on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "ZmFrZS1wbmc=" }] }),
    });
    const result = await generateOpenAIImage({ prompt: "a cat", modelId: "gpt-image-1", size: "1024x1024" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ images: ["ZmFrZS1wbmc="] });
    expect(result.provider).toBe("OPENAI");
  });

  it("fails on a non-2xx HTTP response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => "bad prompt" });
    const result = await generateOpenAIImage({ prompt: "a cat", modelId: "gpt-image-1", size: "1024x1024" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/400/);
  });

  it("fails when no image data is returned", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const result = await generateOpenAIImage({ prompt: "a cat", modelId: "gpt-image-1", size: "1024x1024" });
    expect(result.ok).toBe(false);
  });
});
