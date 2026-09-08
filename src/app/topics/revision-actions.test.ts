import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canManageContentAssets: () => true }));
vi.mock("@/lib/content-versions", () => ({ nextVersionNumber: () => 2 }));
vi.mock("@/lib/content-mapping", () => ({
  deriveTitleAndContent: () => ({ title: "标题", content: "正文" }),
  buildWechatBrandFooter: () => "footer",
  CONTENT_TYPE_REVISION: { video_script: "VIDEO_REVISION" },
}));
vi.mock("@/lib/brand-config", () => ({ getBrandConfig: vi.fn().mockResolvedValue({ contentBrand: "LeoVisa" }) }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { VIDEO_REVISION: "reviser" } }));
vi.mock("@/lib/ai/usage-log", () => ({ writeUsageLog: vi.fn().mockResolvedValue({ usageLogFailed: false }) }));

const getContentAssetByIdMock = vi.fn();
const getContentAssetsMock = vi.fn();
const getResearchPackByIdMock = vi.fn();
const getResearchSourcesMock = vi.fn();
const getTopicByIdMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getContentAssetById: (...args: unknown[]) => getContentAssetByIdMock(...args),
  getContentAssets: (...args: unknown[]) => getContentAssetsMock(...args),
  getResearchPackById: (...args: unknown[]) => getResearchPackByIdMock(...args),
  getResearchSources: (...args: unknown[]) => getResearchSourcesMock(...args),
  getTopicById: (...args: unknown[]) => getTopicByIdMock(...args),
}));

const runContentRevisionTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runContentRevisionTask: (...args: unknown[]) => runContentRevisionTaskMock(...args),
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

function chainable(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => Promise.resolve({ error: null }),
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  if (table === "compliance_reviews") return chainable({ data: { findings: ["issue 1"] }, error: null });
  return chainable({ data: null, error: null });
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { reviseContentAsset } from "./revision-actions";

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
 * Live audit finding (P0, round 6): reviseContentAsset calls a real
 * billable model. Sequential retries are already naturally idempotent
 * (a revision produces a new version with no review yet, so
 * computeAnyFlagged stops seeing it as flagged), but two concurrent
 * requests can both compute the same flagged set before either produces a
 * revision. These tests cover the atomic-claim wiring, only engaged when
 * runId is supplied.
 */
describe("reviseContentAsset — atomic claim wiring (runId provided)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentAssetByIdMock.mockResolvedValue({
      id: "asset-1",
      topic_id: "topic-1",
      platform: "VIDEO_CHANNEL",
      content_type: "video_script",
      content: "text",
      research_pack_id: "pack-1",
    });
    getTopicByIdMock.mockResolvedValue({ id: "topic-1" });
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1" });
    getResearchSourcesMock.mockResolvedValue([]);
    getContentAssetsMock.mockResolvedValue([]);
  });

  it("does not call the AI when the claim reports already_completed", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "already_completed" });

    const result = await reviseContentAsset("asset-1", undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runContentRevisionTaskMock).not.toHaveBeenCalled();
  });

  it("does not call the AI when the claim times out, and surfaces the timeout error", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" });

    const result = await reviseContentAsset("asset-1", undefined, "run-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/等待超时/);
    expect(runContentRevisionTaskMock).not.toHaveBeenCalled();
  });

  it("acquires the claim, calls the AI, and marks the task completed on success", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "acquired" });
    runContentRevisionTaskMock.mockResolvedValue(RESOLVED_RESULT);

    const result = await reviseContentAsset("asset-1", undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runContentRevisionTaskMock).toHaveBeenCalledTimes(1);
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "revision:asset-1");
    expect(failGenerationRunTaskMock).not.toHaveBeenCalled();
  });

  it("does not touch the claim at all when runId is omitted (manual revise click)", async () => {
    runContentRevisionTaskMock.mockResolvedValue(RESOLVED_RESULT);

    const result = await reviseContentAsset("asset-1");

    expect(result).toEqual({ ok: true });
    expect(claimGenerationRunTaskMock).not.toHaveBeenCalled();
  });
});
