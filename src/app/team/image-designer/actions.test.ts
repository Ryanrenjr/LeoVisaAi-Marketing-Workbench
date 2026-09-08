import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentAsset } from "@/lib/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canManageContentAssets: () => true }));
vi.mock("@/lib/leo-portraits", () => ({ getLatestLeoPortrait: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/brand-config", () => ({ getBrandConfig: vi.fn().mockResolvedValue({ contentBrand: "LeoVisa" }) }));
vi.mock("@/lib/employee-instructions", () => ({ getEmployeeInstruction: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ai/prompt-addendum", () => ({ appendCustomInstructions: (prompt: string) => prompt }));
vi.mock("@/lib/ai/image-generation", () => ({
  buildCoverImagePrompt: () => "cover prompt",
  buildCarouselImagePrompt: () => "carousel prompt",
}));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { IMAGE_GENERATION: "image-designer" } }));
vi.mock("@/lib/ai/usage-log", () => ({ writeUsageLog: vi.fn().mockResolvedValue({ usageLogFailed: false }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: vi.fn(), storage: { from: vi.fn() } }) }));

const getTopicByIdMock = vi.fn();
const getContentAssetsMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getTopicById: (...args: unknown[]) => getTopicByIdMock(...args),
  getContentAssets: (...args: unknown[]) => getContentAssetsMock(...args),
}));

const runImageGenerationTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runImageGenerationTask: (...args: unknown[]) => runImageGenerationTaskMock(...args),
  isRouterResolutionFailure: (result: { provider: unknown }) => result.provider === null,
}));

const saveGeneratedContentImageMock = vi.fn();
vi.mock("@/lib/content-images", () => ({ saveGeneratedContentImage: (...args: unknown[]) => saveGeneratedContentImageMock(...args) }));

import { generateXiaohongshuCarousel } from "./actions";

function plan(pages: string[]): ContentAsset {
  return {
    id: "plan-1",
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_pages",
    version: 1,
    title: "计划",
    structured_content: { pages },
  } as unknown as ContentAsset;
}

const resolvedResult = (provider = "OPENAI") => ({
  ok: true,
  data: { images: ["base64"] },
  provider,
  modelId: "gpt-image-1",
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 10,
});

/**
 * Live audit finding (P0, round 3): partial carousel failure used to
 * report ok: (generated > 0) — a single failed page among several was
 * masked as success because *some* pages had made it, so the pipeline's
 * fail-closed check (!result.value.ok in runImageGenerationStep) never
 * fired and the run proceeded as if every page existed.
 */
describe("generateXiaohongshuCarousel — partial failure must never report ok:true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", title: "标题", business: "UK_VISA" });
    getContentAssetsMock.mockResolvedValue([plan(["P1 文案", "P2 文案"])]);
    saveGeneratedContentImageMock.mockResolvedValue({ ok: true });
  });

  it("reports ok:false when page 1 succeeds but page 2's router resolution fails, while still counting page 1 as generated", async () => {
    runImageGenerationTaskMock
      .mockResolvedValueOnce(resolvedResult())
      .mockResolvedValueOnce({ ok: false, data: null, error: "no free model", provider: null, modelId: null, inputTokens: null, outputTokens: null, latencyMs: 5 });

    const result = await generateXiaohongshuCarousel("topic-1");

    expect(result.ok).toBe(false);
    expect(result.generated).toBe(1);
  });

  it("reports ok:false when page 1 succeeds but page 2's saveGeneratedContentImage fails", async () => {
    runImageGenerationTaskMock.mockResolvedValue(resolvedResult());
    saveGeneratedContentImageMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "storage save failed" });

    const result = await generateXiaohongshuCarousel("topic-1");

    expect(result.ok).toBe(false);
    expect(result.generated).toBe(1);
  });

  it("reports ok:false when the AI call itself returns ok:false (not a router resolution failure)", async () => {
    runImageGenerationTaskMock
      .mockResolvedValueOnce(resolvedResult())
      .mockResolvedValueOnce({ ok: false, data: null, error: "model refused", provider: "OPENAI", modelId: "gpt-image-1", inputTokens: 0, outputTokens: 0, latencyMs: 5 });

    const result = await generateXiaohongshuCarousel("topic-1");

    expect(result.ok).toBe(false);
    expect(result.generated).toBe(1);
  });

  it("reports ok:true only when every page genuinely succeeds", async () => {
    runImageGenerationTaskMock.mockResolvedValue(resolvedResult());

    const result = await generateXiaohongshuCarousel("topic-1");

    expect(result).toEqual({ ok: true, generated: 2 });
  });
});
