// server-only unconditionally throws outside Next's bundler — stubbed
// purely so this file is importable under Vitest. Both provider modules
// are fully mocked below; this file never makes a live network call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generateGoogleStructuredMock, generateGroqStructuredMock } = vi.hoisted(() => ({
  generateGoogleStructuredMock: vi.fn(),
  generateGroqStructuredMock: vi.fn(),
}));

vi.mock("./providers/google-provider", () => ({ generateGoogleStructured: generateGoogleStructuredMock }));
vi.mock("./providers/groq-provider", () => ({ generateGroqStructured: generateGroqStructuredMock }));

const { checkProviderHealth } = await import("./provider-health");

beforeEach(() => {
  generateGoogleStructuredMock.mockReset();
  generateGroqStructuredMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkProviderHealth", () => {
  it("reports NOT_CONFIGURED without ever calling the provider", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    const result = await checkProviderHealth("GOOGLE");
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.modelId).toBeNull();
    expect(generateGoogleStructuredMock).not.toHaveBeenCalled();
  });

  it("reports SUCCESS with latency and token usage on a real (mocked) success", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { status: "ok" },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.6-flash",
      inputTokens: 5,
      outputTokens: 2,
      latencyMs: 10,
    });
    const result = await checkProviderHealth("GOOGLE");
    expect(result.status).toBe("SUCCESS");
    expect(result.modelId).not.toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(2);
    expect(result.error).toBeNull();
  });

  it("reports FAILED with the provider's error message when the call fails", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    generateGroqStructuredMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "rate limited",
      provider: "GROQ",
      modelId: "openai/gpt-oss-120b",
      inputTokens: null,
      outputTokens: null,
      latencyMs: 5,
    });
    const result = await checkProviderHealth("GROQ");
    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("rate limited");
  });

  it("never exposes an API key in the result", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "sk-super-secret-value");
    generateGoogleStructuredMock.mockResolvedValueOnce({
      ok: true,
      data: { status: "ok" },
      error: null,
      provider: "GOOGLE",
      modelId: "gemini-3.6-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    const result = await checkProviderHealth("GOOGLE");
    expect(JSON.stringify(result)).not.toContain("sk-super-secret-value");
  });
});
