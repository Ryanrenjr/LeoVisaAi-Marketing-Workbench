import { describe, it, expect, vi, beforeEach } from "vitest";

// server-only unconditionally throws outside Next's bundler — stubbed for tests (see content-agent.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("./supabase/config", () => ({ isSupabaseConfigured: () => true }));

import { saveGeneratedContentImage } from "./content-images";

function fakeSupabase(opts: { uploadError?: { message: string } | null; insertError?: { message: string } | null; removeError?: { message: string } | null }) {
  const removeMock = vi.fn().mockResolvedValue({ error: opts.removeError ?? null });
  const uploadMock = vi.fn().mockResolvedValue({ error: opts.uploadError ?? null });
  const insertMock = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  return {
    supabase: {
      storage: { from: () => ({ upload: uploadMock, remove: removeMock }) },
      from: () => ({ insert: insertMock }),
    } as unknown as Parameters<typeof saveGeneratedContentImage>[0],
    removeMock,
    uploadMock,
  };
}

const BASE_PARAMS = {
  topicId: "topic-1",
  contentAssetId: "asset-1",
  prompt: "prompt",
  imageBase64: "aGVsbG8=",
  provider: "OPENAI",
  modelId: "gpt-image-1",
  userId: "operator-1",
  imageKind: "cover" as const,
  pageIndex: null,
};

/**
 * Live audit finding (P0, round 3): when the Storage upload succeeded but
 * the content_images metadata insert failed, the uploaded file was left
 * behind with no DB row pointing at it — an orphan discardTopic() can
 * never find (it only ever looks at content_images rows), breaking the
 * "nothing survives a topic's session" one-shot guarantee.
 */
describe("saveGeneratedContentImage — compensating Storage cleanup on DB failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the just-uploaded file from Storage when the metadata insert fails", async () => {
    const { supabase, removeMock } = fakeSupabase({ insertError: { message: "db down" } });

    const result = await saveGeneratedContentImage(supabase, BASE_PARAMS);

    expect(result.ok).toBe(false);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("still reports failure (with an extra hint) if the compensating cleanup itself fails", async () => {
    const { supabase } = fakeSupabase({ insertError: { message: "db down" }, removeError: { message: "storage down" } });

    const result = await saveGeneratedContentImage(supabase, BASE_PARAMS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/清理临时文件也失败/);
  });

  it("does not touch Storage cleanup when everything succeeds", async () => {
    const { supabase, removeMock } = fakeSupabase({});

    const result = await saveGeneratedContentImage(supabase, BASE_PARAMS);

    expect(result.ok).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("never calls insert when the upload itself fails", async () => {
    const { supabase, removeMock } = fakeSupabase({ uploadError: { message: "upload failed" } });

    const result = await saveGeneratedContentImage(supabase, BASE_PARAMS);

    expect(result.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
