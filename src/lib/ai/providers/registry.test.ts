import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getModel,
  isModelSuitableForTask,
  isProviderConfigured,
  listModels,
  listModelsForTask,
  providerEnvVarName,
} from "./registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getModel", () => {
  it("finds a registered model by provider + modelId", () => {
    const model = getModel("ANTHROPIC", "claude-opus-5");
    expect(model?.displayName).toBe("Claude Opus 5");
  });

  it("returns null for an unregistered model", () => {
    expect(getModel("ANTHROPIC", "not-a-real-model")).toBeNull();
  });
});

describe("isModelSuitableForTask", () => {
  it("requires only supportsStructuredOutput for RESEARCH — not supportsWebSearch — since the live path (Search Router) never calls the model's own search tool", () => {
    const anthropic = getModel("ANTHROPIC", "claude-opus-5")!;
    const groq = getModel("GROQ", "openai/gpt-oss-120b")!;
    const openaiSol = getModel("OPENAI", "gpt-5.6-sol")!;
    expect(isModelSuitableForTask(anthropic, "RESEARCH")).toBe(true);
    expect(isModelSuitableForTask(groq, "RESEARCH")).toBe(true);
    expect(isModelSuitableForTask(openaiSol, "RESEARCH")).toBe(true);
    // gpt-image-2 is the one registry entry with supportsStructuredOutput: false.
    const image = getModel("OPENAI", "gpt-image-2")!;
    expect(isModelSuitableForTask(image, "RESEARCH")).toBe(false);
  });

  it("requires supportsStructuredOutput for content-writing tasks", () => {
    const model = getModel("GROQ", "openai/gpt-oss-120b")!;
    expect(isModelSuitableForTask(model, "VIDEO_WRITING")).toBe(true);
  });

  it("excludes disabled models regardless of task type", () => {
    const model = getModel("ANTHROPIC", "claude-opus-5")!;
    expect(isModelSuitableForTask({ ...model, enabled: false }, "VIDEO_WRITING")).toBe(false);
  });

  it("has suitable models for COMPLIANCE — live as of the Digital Employee Expansion milestone", () => {
    expect(listModelsForTask("COMPLIANCE").length).toBeGreaterThan(0);
  });
});

describe("listModelsForTask", () => {
  it("only returns models satisfying the task's capability requirement", () => {
    const models = listModelsForTask("RESEARCH");
    expect(models.every((m) => m.supportsStructuredOutput)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("listModels", () => {
  it("returns the full registry", () => {
    expect(listModels().length).toBeGreaterThan(0);
  });
});

describe("Round 2 — new registry entries and fixed stale claims", () => {
  it("registers claude-sonnet-5, gpt-5.6-luna, and gemini-3.8-flash", () => {
    expect(getModel("ANTHROPIC", "claude-sonnet-5")?.displayName).toBe("Claude Sonnet 5");
    expect(getModel("OPENAI", "gpt-5.6-luna")?.displayName).toBe("GPT-5.6 Luna (OpenAI)");
    expect(getModel("GOOGLE", "gemini-3.8-flash")?.displayName).toBe("Gemini 3.8 Flash");
  });

  it("no longer claims gemini-3.5-flash-lite has an official 2026-10-16 shutdown date", () => {
    const model = getModel("GOOGLE", "gemini-3.5-flash-lite")!;
    expect(model.pricingNote).not.toContain("2026-10-16");
    expect(model.pricingNote).not.toContain("停用");
  });

  it("locks OpenAI GPT-5.6 reasoning effort: Sol=high, Terra=medium", () => {
    expect(getModel("OPENAI", "gpt-5.6-sol")?.reasoningEffort).toBe("high");
    expect(getModel("OPENAI", "gpt-5.6-terra")?.reasoningEffort).toBe("medium");
  });

  it("gpt-5.6-luna is registry-only — not development-recommended (not a production default this round)", () => {
    expect(getModel("OPENAI", "gpt-5.6-luna")?.developmentRecommended).toBe(false);
  });

  it("gemini-3.8-flash is the new dev-recommended Flash default; gemini-3.6-flash is kept but demoted", () => {
    expect(getModel("GOOGLE", "gemini-3.8-flash")?.developmentRecommended).toBe(true);
    const legacy = getModel("GOOGLE", "gemini-3.6-flash")!;
    expect(legacy.enabled).toBe(true);
    expect(legacy.developmentRecommended).toBe(false);
  });

  it("gpt-image-2 is untouched — still the only supportsImageGeneration entry", () => {
    const image = getModel("OPENAI", "gpt-image-2")!;
    expect(image.supportsImageGeneration).toBe(true);
    expect(getModel("OPENAI", "gpt-image-2.5-sunburst")).toBeNull();
    expect(getModel("OPENAI", "gpt-image-2.5-flare")).toBeNull();
  });
});

describe("isProviderConfigured / providerEnvVarName", () => {
  it("reports configured when the provider's env var is set", () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    expect(isProviderConfigured("GROQ")).toBe(true);
  });

  it("reports not configured when unset", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isProviderConfigured("GROQ")).toBe(false);
  });

  it("maps each provider to its documented env var name", () => {
    expect(providerEnvVarName("ANTHROPIC")).toBe("ANTHROPIC_API_KEY");
    expect(providerEnvVarName("GOOGLE")).toBe("GOOGLE_AI_API_KEY");
    expect(providerEnvVarName("GROQ")).toBe("GROQ_API_KEY");
    expect(providerEnvVarName("OPENROUTER")).toBe("OPENROUTER_API_KEY");
  });
});
