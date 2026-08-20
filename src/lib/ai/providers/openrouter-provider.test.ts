// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. global fetch is mocked
// below; these tests never make a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { generateOpenRouterStructured, isOpenRouterConfigured } = await import("./openrouter-provider");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isOpenRouterConfigured", () => {
  it("reports configured when OPENROUTER_API_KEY is set", () => {
    expect(isOpenRouterConfigured()).toBe(true);
  });
  it("reports not configured when unset", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(isOpenRouterConfigured()).toBe(false);
  });
});

describe("generateOpenRouterStructured", () => {
  const schema = z.object({ title: z.string() });

  it("fails fast when not configured — never attempts a call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const result = await generateOpenRouterStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "meta-llama/llama-3.3-70b-instruct:free",
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
    const result = await generateOpenRouterStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ title: "标题" });
    expect(result.provider).toBe("OPENROUTER");

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body as string);
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("fails on a non-2xx HTTP response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" });
    const result = await generateOpenRouterStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
  });

  it("fails when output doesn't validate against the schema", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({}) } }] }),
    });
    const result = await generateOpenRouterStructured({
      systemPrompt: "sys",
      userMessage: "msg",
      schema,
      modelId: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/校验/);
  });
});
