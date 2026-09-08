import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }),
}));
vi.mock("@/lib/permissions", () => ({
  canApproveResearch: () => true,
  canArchiveTopic: () => true,
}));
vi.mock("@/lib/scoring", () => ({ computeTopicScore: vi.fn() }));
vi.mock("@/lib/topic-validation", () => ({ validateTopicInput: vi.fn() }));
vi.mock("@/lib/topic-workflow", () => ({ canArchive: () => true, canStartResearch: () => true }));
vi.mock("@/lib/topics", () => ({ getTopicById: vi.fn() }));

const selectEqMock = vi.fn();
const storageRemoveMock = vi.fn();
const deleteEqMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "content_images") {
        return { select: () => ({ eq: selectEqMock }) };
      }
      if (table === "topics") {
        return { delete: () => ({ eq: deleteEqMock }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    storage: { from: () => ({ remove: storageRemoveMock }) },
  }),
}));

import { discardTopic } from "./actions";

/**
 * Live audit finding (P0): discardTopic used to ignore every error from
 * Storage removal and the topics delete, then unconditionally redirect as
 * if it had succeeded — the exact scenario that leaves an orphaned image
 * in Storage with no database row pointing at it, which is precisely what
 * the "one-shot, no leftover content" design is supposed to prevent.
 */
describe("discardTopic fail-safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteEqMock.mockResolvedValue({ error: null });
  });

  it("does not delete the topic row when Storage cleanup fails", async () => {
    selectEqMock.mockResolvedValue({ data: [{ image_path: "a.png" }], error: null });
    storageRemoveMock.mockResolvedValue({ error: { message: "storage unavailable" } });

    await expect(discardTopic("topic-1")).rejects.toThrow(/清理图片失败/);
    expect(deleteEqMock).not.toHaveBeenCalled();
  });

  it("throws instead of redirecting when the topic delete itself fails", async () => {
    selectEqMock.mockResolvedValue({ data: [], error: null });
    deleteEqMock.mockResolvedValue({ error: { message: "db error" } });

    await expect(discardTopic("topic-1")).rejects.toThrow(/删除失败/);
  });

  it("throws if reading the topic's images fails, before ever touching Storage", async () => {
    selectEqMock.mockResolvedValue({ data: null, error: { message: "read failed" } });

    await expect(discardTopic("topic-1")).rejects.toThrow(/读取选题图片失败/);
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });

  it("succeeds through to the topic delete when Storage cleanup succeeds", async () => {
    selectEqMock.mockResolvedValue({ data: [{ image_path: "a.png" }], error: null });
    storageRemoveMock.mockResolvedValue({ error: null });

    // discardTopic calls redirect() on success, which next/navigation's real implementation
    // throws a special control-flow signal for — here it's mocked to a no-op vi.fn(), so a
    // successful run completes normally instead of throwing.
    await expect(discardTopic("topic-1")).resolves.toBeUndefined();
    expect(storageRemoveMock).toHaveBeenCalledWith(["a.png"]);
    expect(deleteEqMock).toHaveBeenCalledWith("id", "topic-1");
  });

  it("dedupes Storage paths before removing — a shared 视频号/小红书 cover is one Storage object referenced by two content_images rows", async () => {
    selectEqMock.mockResolvedValue({
      data: [{ image_path: "shared-cover.png" }, { image_path: "shared-cover.png" }, { image_path: "b.png" }],
      error: null,
    });
    storageRemoveMock.mockResolvedValue({ error: null });

    await expect(discardTopic("topic-1")).resolves.toBeUndefined();
    expect(storageRemoveMock).toHaveBeenCalledWith(["shared-cover.png", "b.png"]);
  });
});
