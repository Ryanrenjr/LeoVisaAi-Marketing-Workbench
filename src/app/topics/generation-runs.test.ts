import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/leo-portraits", () => ({ getLatestLeoPortrait: vi.fn() }));
vi.mock("./content-actions", () => ({ generateContent: vi.fn() }));
vi.mock("./research-actions", () => ({ approveResearchOnly: vi.fn() }));
vi.mock("../team/xiaohongshu-image-planner/actions", () => ({ generatePagesPlan: vi.fn() }));
vi.mock("../team/image-designer/actions", () => ({
  generateCrossPlatformCover: vi.fn(),
  generateWechatCover: vi.fn(),
  generateXiaohongshuCarousel: vi.fn(),
}));
vi.mock("@/lib/topics", () => ({ getContentAssets: vi.fn(), getComplianceReviews: vi.fn() }));
vi.mock("./compliance-actions", () => ({ runComplianceReview: vi.fn() }));
vi.mock("./revision-actions", () => ({ reviseContentAsset: vi.fn() }));

const requireUserMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: (...args: unknown[]) => requireUserMock(...args) }));

const canManageContentAssetsMock = vi.fn();
vi.mock("@/lib/permissions", () => ({ canManageContentAssets: (...args: unknown[]) => canManageContentAssetsMock(...args) }));

const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

/**
 * Thenable + chainable stub for the Supabase query builder: every builder
 * method (`eq`, `order`, `limit`, `select`, `insert`, `update`) returns the
 * same object so any call chain resolves, and awaiting the object directly
 * (no terminal `.maybeSingle()`/`.single()`) also works via `.then` — matches
 * how markGenerationRunStep/completeGenerationRun/failGenerationRun await an
 * `update().eq()` chain with no `.select()` after it.
 */
function chainable(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

import {
  getOrCreateGenerationRun,
  markGenerationRunStep,
  completeGenerationRun,
  failGenerationRun,
  retryGenerationRun,
} from "./pipeline-actions";

/**
 * Live audit finding (P0, round 2): these four functions used to write to
 * generation_runs without checking for a Supabase error — a write failure
 * here means "the AI call actually succeeded, but the system never wrote
 * down that it did," so a refresh re-runs (and re-bills) it. Every path
 * below must throw, never silently swallow the error.
 */
describe("generation_runs bookkeeping — fail closed on DB errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: "operator-1", role: "ADMIN" });
    canManageContentAssetsMock.mockReturnValue(true);
  });

  it("requires ADMIN-capable access before touching the DB at all", async () => {
    canManageContentAssetsMock.mockReturnValue(false);
    await expect(getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"])).rejects.toThrow(/Forbidden/);
    expect(fromMock).not.toHaveBeenCalled();
  });

  describe("getOrCreateGenerationRun — race-safe via UNIQUE(topic_id) + upsert(ignoreDuplicates)", () => {
    const row = {
      id: "run-1",
      platforms: ["VIDEO_CHANNEL"],
      status: "running",
      completed_steps: ["content"],
      error: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    it("throws if the upsert itself errors", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: null, error: { message: "upsert failed" } }));
      await expect(getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"])).rejects.toThrow(/无法开始生成流程/);
    });

    it("returns the newly-created row when this request wins the race (upsert inserts a row)", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: [row], error: null }));

      const run = await getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"]);
      expect(run.id).toBe("run-1");
      expect(fromMock).toHaveBeenCalledTimes(1); // never fell back to a second read
    });

    it("live audit finding (round 6): falls back to reading the existing row when another concurrent request already won — never a second insert, never an error", async () => {
      fromMock
        .mockReturnValueOnce(chainable({ data: [], error: null })) // upsert ignored — conflict, someone else already has a row
        .mockReturnValueOnce(chainable({ data: row, error: null })); // fallback read of the winner's row

      const run = await getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"]);
      expect(run.id).toBe("run-1");
      expect(fromMock).toHaveBeenCalledTimes(2);
    });

    it("throws if the fallback read (after losing the upsert race) itself fails", async () => {
      fromMock
        .mockReturnValueOnce(chainable({ data: [], error: null }))
        .mockReturnValueOnce(chainable({ data: null, error: { message: "select failed" } }));

      await expect(getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"])).rejects.toThrow(/读取生成进度失败/);
    });

    it("throws (rather than returning nothing) if the fallback read somehow finds no row at all", async () => {
      fromMock
        .mockReturnValueOnce(chainable({ data: [], error: null }))
        .mockReturnValueOnce(chainable({ data: null, error: null }));

      await expect(getOrCreateGenerationRun("topic-1", ["VIDEO_CHANNEL"])).rejects.toThrow(/无法读取生成进度/);
    });
  });

  describe("markGenerationRunStep", () => {
    it("throws if reading current progress fails", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: null, error: { message: "read failed" } }));
      await expect(markGenerationRunStep("run-1", "content")).rejects.toThrow(/读取生成进度失败/);
    });

    it("throws if persisting the step fails, even though the read succeeded", async () => {
      fromMock
        .mockReturnValueOnce(chainable({ data: { completed_steps: [] }, error: null }))
        .mockReturnValueOnce(chainable({ data: null, error: { message: "update failed" } }));

      await expect(markGenerationRunStep("run-1", "content")).rejects.toThrow(/记录生成进度失败/);
    });
  });

  describe("completeGenerationRun / failGenerationRun", () => {
    it("completeGenerationRun throws when the update fails", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: null, error: { message: "update failed" } }));
      await expect(completeGenerationRun("run-1")).rejects.toThrow(/标记生成完成失败/);
    });

    it("failGenerationRun throws when the update fails", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: null, error: { message: "update failed" } }));
      await expect(failGenerationRun("run-1", "boom")).rejects.toThrow(/记录失败状态失败/);
    });
  });

  describe("retryGenerationRun", () => {
    it("throws when the DB update fails", async () => {
      fromMock.mockReturnValueOnce(chainable({ data: null, error: { message: "update failed" } }));
      await expect(retryGenerationRun("run-1")).rejects.toThrow(/重试失败/);
    });

    it("resets status to running and clears the error on success", async () => {
      const row = {
        id: "run-1",
        platforms: ["VIDEO_CHANNEL"],
        status: "running",
        completed_steps: ["content"],
        error: null,
        created_at: "2026-01-01T00:00:00Z",
      };
      fromMock.mockReturnValueOnce(chainable({ data: row, error: null }));

      const run = await retryGenerationRun("run-1");
      expect(run.status).toBe("running");
      expect(run.error).toBeNull();
    });
  });
});
