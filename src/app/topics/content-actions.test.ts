import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canGenerateContent: () => true, canManageContentAssets: () => true }));
vi.mock("@/lib/content-versions", () => ({
  getLatestForLineage: () => null,
  nextVersionNumber: () => 1,
}));
vi.mock("@/lib/content-mapping", () => ({
  deriveTitleAndContent: () => ({ title: "标题", content: "正文" }),
  buildWechatBrandFooter: () => "footer",
  mergeEditIntoStructuredContent: vi.fn(),
}));
vi.mock("@/lib/brand-config", () => ({ getBrandConfig: vi.fn().mockResolvedValue({ contentBrand: "LeoVisa" }) }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/providers/types", () => ({
  TASK_TYPE_EMPLOYEE: { VIDEO_WRITING: "video-editor", XIAOHONGSHU_WRITING: "xiaohongshu-editor", WECHAT_ARTICLE_WRITING: "wechat-editor" },
}));
vi.mock("@/lib/ai/usage-log", () => ({ writeUsageLog: vi.fn().mockResolvedValue({ usageLogFailed: false }) }));

const getTopicByIdMock = vi.fn();
const getContentAssetsMock = vi.fn();
const getLatestResearchPackMock = vi.fn();
const getResearchSourcesMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getTopicById: (...args: unknown[]) => getTopicByIdMock(...args),
  getContentAssets: (...args: unknown[]) => getContentAssetsMock(...args),
  getLatestResearchPack: (...args: unknown[]) => getLatestResearchPackMock(...args),
  getResearchSources: (...args: unknown[]) => getResearchSourcesMock(...args),
}));

const runContentTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runContentTask: (...args: unknown[]) => runContentTaskMock(...args),
  runWechatFullArticleTask: vi.fn(),
  isRouterResolutionFailure: (result: { provider: unknown }) => result.provider === null,
}));

const claimGenerationRunTaskMock = vi.fn();
const completeGenerationRunTaskMock = vi.fn();
const failGenerationRunTaskMock = vi.fn();
vi.mock("@/lib/generation-run-tasks", () => ({
  claimGenerationRunTask: (...args: unknown[]) => claimGenerationRunTaskMock(...args),
  completeGenerationRunTask: (...args: unknown[]) => completeGenerationRunTaskMock(...args),
  failGenerationRunTask: (...args: unknown[]) => failGenerationRunTaskMock(...args),
}));

const fromMock = vi.fn(() => ({
  insert: () => Promise.resolve({ error: null }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { generateContent } from "./content-actions";

const RESOLVED_RESULT = {
  ok: true,
  data: { title: "标题", body: "正文" },
  provider: "ANTHROPIC",
  modelId: "claude",
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 5,
};

/**
 * Live audit finding (P0, round 6): the `since` prefilter in generateContent
 * closes the retry-level race (a failed platform gets redone, successful
 * ones don't), but not the concurrent-request-level one — two requests can
 * both pass the since check for the same platform before either writes.
 * These tests cover the atomic-claim wiring added inside
 * generateAndPersistPlatform, only engaged when runId is supplied.
 */
describe("generateContent — atomic claim wiring (runId provided)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_APPROVED" });
    getContentAssetsMock.mockResolvedValue([]);
    getLatestResearchPackMock.mockResolvedValue({ id: "pack-1" });
    getResearchSourcesMock.mockResolvedValue([]);
  });

  it("does not call the AI for a platform whose claim reports already_completed", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "already_completed" });

    await generateContent("topic-1", ["VIDEO_CHANNEL"], undefined, "run-1");

    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("throws (fails the step) when the claim times out, without ever calling the AI", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" });

    await expect(generateContent("topic-1", ["VIDEO_CHANNEL"], undefined, "run-1")).rejects.toThrow(/内容生成失败/);
    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("acquires the claim, calls the AI, and marks the platform's task completed on success", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "acquired" });
    runContentTaskMock.mockResolvedValue(RESOLVED_RESULT);

    await generateContent("topic-1", ["VIDEO_CHANNEL"], undefined, "run-1");

    expect(runContentTaskMock).toHaveBeenCalledTimes(1);
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "content:VIDEO_CHANNEL");
    expect(failGenerationRunTaskMock).not.toHaveBeenCalled();
  });

  it("does not touch the claim at all when runId is omitted (manual regeneration path)", async () => {
    runContentTaskMock.mockResolvedValue(RESOLVED_RESULT);

    await generateContent("topic-1", ["VIDEO_CHANNEL"]);

    expect(claimGenerationRunTaskMock).not.toHaveBeenCalled();
    expect(runContentTaskMock).toHaveBeenCalledTimes(1);
  });
});
