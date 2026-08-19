// research-agent.ts imports "server-only", which unconditionally throws
// when resolved outside Next.js's bundler (it relies on Next swapping in a
// no-op implementation for genuine server files) — so it's stubbed out
// below purely to make this file importable under Vitest/Node.
//
// The Anthropic SDK itself is fully mocked below — these tests never make
// a live network call, per the instruction not to depend on the real
// Anthropic API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

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
    messages = { stream: streamMock };
  }
  return { default: Object.assign(MockAnthropic, { APIError: MockAPIError }) };
});

const { runResearchAgent, isResearchAgentConfigured, researchAgentModelAlias } = await import(
  "./research-agent"
);
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const TOPIC = {
  title: "老永居离境超过2年，身份还在吗？",
  question: "老永居离境超过2年，身份还在吗？",
  business: "永居 / ILR",
  audience: "持老式永居（ILR）并长期离境的申请人",
};

function fakeFinalMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stop_reason: "end_turn",
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", title: "GOV.UK", url: "https://www.gov.uk/example", page_age: "1 week ago" },
        ],
      },
      {
        type: "text",
        text: JSON.stringify({
          summary: "总结",
          key_findings: ["发现一"],
          sources: [{ title: "GOV.UK", url: "https://www.gov.uk/example", note: "说明" }],
          warnings: "",
          confidence: "HIGH",
        }),
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...overrides,
  };
}

function mockStreamOnce(message: unknown) {
  streamMock.mockReturnValueOnce({ finalMessage: () => Promise.resolve(message) });
}

beforeEach(() => {
  streamMock.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isResearchAgentConfigured / researchAgentModelAlias", () => {
  it("reports configured when ANTHROPIC_API_KEY is set", () => {
    expect(isResearchAgentConfigured()).toBe(true);
  });

  it("reports not configured when ANTHROPIC_API_KEY is unset", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isResearchAgentConfigured()).toBe(false);
  });

  it("defaults the model alias to claude-opus-5", () => {
    expect(researchAgentModelAlias()).toBe("claude-opus-5");
  });
});

describe("runResearchAgent", () => {
  it("fails fast when ANTHROPIC_API_KEY is not set — never attempts a call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns a grounded pack on a successful call", async () => {
    mockStreamOnce(fakeFinalMessage());
    const result = await runResearchAgent(TOPIC);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.pack.summary).toBe("总结");
    expect(result.pack.sources).toHaveLength(1);
    expect(result.pack.confidence).toBe("HIGH");
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(200);
    expect(result.modelAlias).toBe("claude-opus-5");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("drops a fabricated citation end-to-end (not just at the pure-function level)", async () => {
    mockStreamOnce(
      fakeFinalMessage({
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", title: "GOV.UK", url: "https://www.gov.uk/example", page_age: null },
            ],
          },
          {
            type: "text",
            text: JSON.stringify({
              summary: "总结",
              key_findings: [],
              sources: [
                { title: "GOV.UK", url: "https://www.gov.uk/example", note: "真实" },
                { title: "编造的来源", url: "https://fabricated.example/never-searched", note: "假的" },
              ],
              warnings: "",
              confidence: "MEDIUM",
            }),
          },
        ],
      }),
    );

    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.pack.sources).toHaveLength(1);
    expect(result.pack.sources[0].url).toBe("https://www.gov.uk/example");
    expect(result.pack.warnings).toMatch(/1/);
  });

  it("fails with a clear error when the model's final text is not valid JSON", async () => {
    mockStreamOnce(fakeFinalMessage({ content: [{ type: "text", text: "not json at all" }] }));
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/);
  });

  it("fails when the model never returns a text block", async () => {
    mockStreamOnce(fakeFinalMessage({ content: [] }));
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/文本/);
  });

  it("resumes once on pause_turn and then completes successfully", async () => {
    mockStreamOnce({ stop_reason: "pause_turn", content: [{ type: "text", text: "" }] });
    mockStreamOnce(fakeFinalMessage());

    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(true);
    expect(streamMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many consecutive pause_turns", async () => {
    for (let i = 0; i < 10; i++) {
      mockStreamOnce({ stop_reason: "pause_turn", content: [{ type: "text", text: "" }] });
    }
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pause_turn/);
  });

  it("formats an Anthropic API error with its status code", async () => {
    // The mocked APIError has a simpler constructor than the real SDK's
    // (status, error, message, headers, type) — cast past the real type
    // here since only the mock's runtime shape matters for this test.
    const MockAPIError = Anthropic.APIError as unknown as new (status: number, message: string) => Error;
    streamMock.mockImplementationOnce(() => {
      throw new MockAPIError(529, "overloaded");
    });
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/529/);
      expect(result.error).toMatch(/overloaded/);
    }
  });

  it("records latency even on failure", async () => {
    streamMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("computes latency from actual elapsed wall-clock time, not a fixed stub", async () => {
    const DELAY_MS = 30;
    streamMock.mockReturnValueOnce({
      finalMessage: () => new Promise((resolve) => setTimeout(() => resolve(fakeFinalMessage()), DELAY_MS)),
    });
    const result = await runResearchAgent(TOPIC);
    expect(result.ok).toBe(true);
    // Generous lower bound — real timers have some jitter/imprecision.
    expect(result.latencyMs).toBeGreaterThanOrEqual(DELAY_MS - 10);
  });
});
