import { describe, expect, it, vi } from "vitest";
import { selectModel, requiresPaidWarning } from "./model-selection";
import * as registry from "./providers/registry";

describe("selectModel", () => {
  it("prefers an explicit execution override over everything else", () => {
    const result = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: true,
      configuredDefault: { provider: "ANTHROPIC", modelId: "claude-opus-5" },
      executionOverride: { provider: "GROQ", modelId: "openai/gpt-oss-120b" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("override");
      expect(result.model.provider).toBe("GROQ");
    }
  });

  it("rejects an override that doesn't exist in the registry", () => {
    const result = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: true,
      configuredDefault: null,
      executionOverride: { provider: "GROQ", modelId: "not-a-real-model" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/不存在|停用/);
  });

  it("rejects an override lacking web-search capability for RESEARCH with the exact required message", () => {
    const result = selectModel({
      taskType: "RESEARCH",
      developmentMode: true,
      configuredDefault: null,
      executionOverride: { provider: "GROQ", modelId: "openai/gpt-oss-120b" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("此模型不支持当前研究流程所需的联网能力。");
  });

  it("prefers ADMIN's configured default over Development Mode free-first, even when a free model would otherwise qualify", () => {
    const result = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: true,
      configuredDefault: { provider: "ANTHROPIC", modelId: "claude-opus-5" },
      executionOverride: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("configured_default");
      expect(result.model.provider).toBe("ANTHROPIC");
    }
  });

  it("Development Mode picks a development-recommended FREE model when nothing else is specified", () => {
    const result = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: true,
      configuredDefault: null,
      executionOverride: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("development_free_first");
      expect(result.model.pricingType).toBe("FREE");
      expect(result.model.developmentRecommended).toBe(true);
    }
  });

  it("never silently falls back to a paid model when no free model satisfies the task", () => {
    // Every real task type currently has at least one FREE+recommended
    // candidate in the registry (by design — see docs/model-router.md),
    // so this test can no longer rely on a real task type having zero
    // coverage. Instead it spies on listModelsForTask directly to
    // simulate that "no free model available" state and verify selectModel
    // still fails clearly rather than silently reaching for a paid model.
    const spy = vi.spyOn(registry, "listModelsForTask").mockReturnValue([]);
    try {
      const result = selectModel({
        taskType: "COMPLIANCE",
        developmentMode: true,
        configuredDefault: null,
        executionOverride: null,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("免费模型当前不可用，请选择其他模型。");
    } finally {
      spy.mockRestore();
    }
  });

  it("requires an explicit configured default outside Development Mode", () => {
    const result = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: false,
      configuredDefault: null,
      executionOverride: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/尚未为该任务配置默认模型/);
  });

  it("falls through to free-first when the configured default is stale, but only in Development Mode", () => {
    const staleDefault = { provider: "GROQ" as const, modelId: "no-longer-registered" };

    const devResult = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: true,
      configuredDefault: staleDefault,
      executionOverride: null,
    });
    expect(devResult.ok).toBe(true);
    if (devResult.ok) expect(devResult.source).toBe("development_free_first");

    const prodResult = selectModel({
      taskType: "VIDEO_WRITING",
      developmentMode: false,
      configuredDefault: staleDefault,
      executionOverride: null,
    });
    expect(prodResult.ok).toBe(false);
    if (!prodResult.ok) expect(prodResult.error).toMatch(/当前不可用/);
  });
});

describe("requiresPaidWarning", () => {
  it("requires a warning for PAID and MIXED models", () => {
    expect(requiresPaidWarning({ pricingType: "PAID" })).toBe(true);
    expect(requiresPaidWarning({ pricingType: "MIXED" })).toBe(true);
  });

  it("does not require a warning for FREE models", () => {
    expect(requiresPaidWarning({ pricingType: "FREE" })).toBe(false);
  });
});
