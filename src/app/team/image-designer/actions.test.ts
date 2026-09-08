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

/** Chainable + thenable Supabase query-builder stub for the content_images idempotency checks (hasExistingImage / carousel's existingImages query). Each `.from("content_images")` call consumes the next queued result. */
const contentImagesResults: { data?: unknown; error?: unknown }[] = [];
function queueContentImagesResult(result: { data?: unknown; error?: unknown }) {
  contentImagesResults.push(result);
}
function chainable(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    gte: () => builder,
    limit: () => builder,
    select: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  if (table === "content_images") return chainable(contentImagesResults.shift() ?? { data: null, error: null });
  return chainable({ data: null, error: null });
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (...args: [string]) => fromMock(...args), storage: { from: vi.fn() } }) }));

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

const claimGenerationRunTaskMock = vi.fn();
const completeGenerationRunTaskMock = vi.fn();
const failGenerationRunTaskMock = vi.fn();
vi.mock("@/lib/generation-run-tasks", () => ({
  claimGenerationRunTask: (...args: unknown[]) => claimGenerationRunTaskMock(...args),
  completeGenerationRunTask: (...args: unknown[]) => completeGenerationRunTaskMock(...args),
  failGenerationRunTask: (...args: unknown[]) => failGenerationRunTaskMock(...args),
}));

import { generateXiaohongshuCarousel, generateCrossPlatformCover, generateWechatCover } from "./actions";

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
    contentImagesResults.length = 0;
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

function xhsPostAsset(): ContentAsset {
  return {
    id: "xhs-post-1",
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_post",
    version: 1,
    title: "标题",
    content: "正文",
    structured_content: {},
  } as unknown as ContentAsset;
}

function wechatArticleAsset(): ContentAsset {
  return {
    id: "wechat-article-1",
    platform: "WECHAT_OFFICIAL_ACCOUNT",
    content_type: "wechat_article",
    version: 1,
    title: "标题",
    content: "正文",
    structured_content: {},
  } as unknown as ContentAsset;
}

/**
 * Live audit finding (P0, round 5): hasExistingImage() used to discard the
 * Supabase query's `error` (`const { data } = ...`) and only look at
 * `data`, so a transient DB failure while checking "was this cover
 * already generated in this run?" was indistinguishable from "no, it
 * wasn't" — the retry would then call the paid image model again instead
 * of stopping. The same bug existed in the carousel's page-level check.
 */
describe("cover idempotency checks fail closed on a DB error, instead of assuming missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentImagesResults.length = 0;
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", title: "标题", business: "UK_VISA" });
  });

  it("generateCrossPlatformCover (shared 视频号/小红书 cover): stops and never calls the image model when the existence check errors", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset()]);
    queueContentImagesResult({ data: null, error: { message: "connection reset" } });

    const result = await generateCrossPlatformCover("topic-1", false, undefined, "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/检查封面是否已生成失败/);
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });

  it("generateCrossPlatformCover: skips generation (no paid call) when the check confirms a cover already exists", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset()]);
    queueContentImagesResult({ data: { id: "img-1" }, error: null });

    const result = await generateCrossPlatformCover("topic-1", false, undefined, "2026-01-01T00:00:00Z");

    expect(result).toEqual({ ok: true });
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });

  it("generateWechatCover: stops and never calls the image model when the existence check errors", async () => {
    getContentAssetsMock.mockResolvedValue([wechatArticleAsset()]);
    queueContentImagesResult({ data: null, error: { message: "connection reset" } });

    const result = await generateWechatCover("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/检查封面是否已生成失败/);
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });
});

describe("Xiaohongshu carousel idempotency check fails closed on a DB error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentImagesResults.length = 0;
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", title: "标题", business: "UK_VISA" });
    getContentAssetsMock.mockResolvedValue([plan(["P1 文案", "P2 文案"])]);
  });

  it("stops before generating any page when the existingImages query errors", async () => {
    queueContentImagesResult({ data: null, error: { message: "connection reset" } });

    const result = await generateXiaohongshuCarousel("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/检查图文是否已生成失败/);
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });

  it("skips only the pages already generated in this run when the check succeeds", async () => {
    queueContentImagesResult({ data: [{ page_index: 1 }], error: null });
    runImageGenerationTaskMock.mockResolvedValue(resolvedResult());
    saveGeneratedContentImageMock.mockResolvedValue({ ok: true });

    const result = await generateXiaohongshuCarousel("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result).toEqual({ ok: true, generated: 2 });
    expect(runImageGenerationTaskMock).toHaveBeenCalledTimes(1); // only page 2, page 1 already existed
  });
});

/**
 * Live audit finding (P0, round 6): the since-based checks above close the
 * retry-level race, but not the concurrent-request-level one — two
 * requests can both pass the since check before either writes. These
 * tests verify the atomic-claim wiring itself: only engaged when a runId
 * is supplied (the orchestrated pipeline), and an "already_completed" or
 * "timed_out" claim outcome must never let a paid call through.
 */
describe("atomic claim wiring (runId provided) — image-designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentImagesResults.length = 0;
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", title: "标题", business: "UK_VISA" });
  });

  it("generateCrossPlatformCover: does not call the image model when the claim reports already_completed", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset()]);
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "already_completed" });

    const result = await generateCrossPlatformCover("topic-1", false, undefined, undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });

  it("generateCrossPlatformCover: does not call the image model when the claim times out, and surfaces the timeout error", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset()]);
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" });

    const result = await generateCrossPlatformCover("topic-1", false, undefined, undefined, "run-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/等待超时/);
    expect(runImageGenerationTaskMock).not.toHaveBeenCalled();
  });

  it("generateCrossPlatformCover: acquires the claim, calls the model, and marks the task completed on success", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset()]);
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "acquired" });
    runImageGenerationTaskMock.mockResolvedValue(resolvedResult());
    saveGeneratedContentImageMock.mockResolvedValue({ ok: true });

    const result = await generateCrossPlatformCover("topic-1", false, undefined, undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runImageGenerationTaskMock).toHaveBeenCalledTimes(1);
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "image:shared_cover");
    expect(failGenerationRunTaskMock).not.toHaveBeenCalled();
  });

  it("generateXiaohongshuCarousel: claims each page independently, skipping only the page the claim reports already_completed", async () => {
    getContentAssetsMock.mockResolvedValue([plan(["P1 文案", "P2 文案"])]);
    claimGenerationRunTaskMock.mockImplementation(async (_runId: string, taskKey: string) =>
      taskKey === "carousel:1" ? { outcome: "already_completed" } : { outcome: "acquired" },
    );
    runImageGenerationTaskMock.mockResolvedValue(resolvedResult());
    saveGeneratedContentImageMock.mockResolvedValue({ ok: true });

    const result = await generateXiaohongshuCarousel("topic-1", undefined, undefined, "run-1");

    expect(result).toEqual({ ok: true, generated: 2 });
    expect(runImageGenerationTaskMock).toHaveBeenCalledTimes(1); // only page 2 actually called the model
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "carousel:2");
  });
});
