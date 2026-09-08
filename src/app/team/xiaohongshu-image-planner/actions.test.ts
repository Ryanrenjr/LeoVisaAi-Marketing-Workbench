import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canGenerateContent: () => true, canManageContentAssets: () => true }));
vi.mock("@/lib/content-versions", () => ({ nextVersionNumber: () => 1 }));
vi.mock("@/lib/content-mapping", () => ({ deriveTitleAndContent: () => ({ title: "标题", content: "正文" }) }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { XIAOHONGSHU_PAGES_PLANNING: "xiaohongshu-image-planner" } }));
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

/** Chainable + thenable Supabase query-builder stub, keyed per table (same pattern as research-actions.test.ts / generation-runs.test.ts). */
const tableResults: Record<string, { data?: unknown; error?: unknown }[]> = {};
const tableCallIndex: Record<string, number> = {};
function queue(table: string, result: { data?: unknown; error?: unknown }) {
  (tableResults[table] ??= []).push(result);
}
function chainable(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    gte: () => builder,
    limit: () => builder,
    insert: () => builder,
    select: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  const idx = tableCallIndex[table] ?? 0;
  tableCallIndex[table] = idx + 1;
  const results = tableResults[table] ?? [];
  return chainable(results[idx] ?? { data: null, error: null });
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { generatePagesPlan } from "./actions";

const RESOLVED_RESULT = {
  ok: true,
  data: { pages: ["P1", "P2"] },
  provider: "ANTHROPIC",
  modelId: "claude",
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 5,
};

/**
 * Live audit finding (P0, round 5): runImagePlanningStep/generatePagesPlan
 * had no `since` param at all — every retry of the planning step (e.g.
 * after markGenerationRunStep failed post-success) called the AI again,
 * re-billing it and creating a redundant xiaohongshu_pages version. The
 * existence check backing `since` must also be fail-closed: a DB error
 * while checking is not the same as "nothing exists yet".
 */
describe("generatePagesPlan — since-based idempotency, fail-closed on a DB error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_APPROVED" });
    getLatestResearchPackMock.mockResolvedValue({ id: "pack-1" });
    getResearchSourcesMock.mockResolvedValue([]);
    getContentAssetsMock.mockResolvedValue([]);
  });

  it("skips the AI call entirely when this run already produced a plan", async () => {
    queue("content_assets", { data: { id: "existing-plan" }, error: null });

    const result = await generatePagesPlan("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result).toEqual({ ok: true });
    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("fails closed (no AI call) when the existence check itself errors", async () => {
    queue("content_assets", { data: null, error: { message: "connection reset" } });

    const result = await generatePagesPlan("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/检查图文规划是否已生成失败/);
    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("generates normally on a first run (since given, nothing exists yet)", async () => {
    queue("content_assets", { data: null, error: null }); // the since-check: nothing found
    runContentTaskMock.mockResolvedValue(RESOLVED_RESULT);
    queue("content_assets", { data: null, error: null }); // the final insert

    const result = await generatePagesPlan("topic-1", undefined, "2026-01-01T00:00:00Z");

    expect(result).toEqual({ ok: true });
    expect(runContentTaskMock).toHaveBeenCalledTimes(1);
  });

  it("generates normally when no since is given at all (manual click from K's own page)", async () => {
    runContentTaskMock.mockResolvedValue(RESOLVED_RESULT);
    queue("content_assets", { data: null, error: null }); // the final insert

    const result = await generatePagesPlan("topic-1");

    expect(result).toEqual({ ok: true });
    expect(runContentTaskMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Live audit finding (P0, round 6): the since check above closes the
 * retry-level race but not the concurrent-request-level one. These tests
 * cover the atomic-claim wiring itself, only engaged when runId is given.
 */
describe("generatePagesPlan — atomic claim wiring (runId provided)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_APPROVED" });
    getLatestResearchPackMock.mockResolvedValue({ id: "pack-1" });
    getResearchSourcesMock.mockResolvedValue([]);
    getContentAssetsMock.mockResolvedValue([]);
  });

  it("does not call the AI when the claim reports already_completed", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "already_completed" });

    const result = await generatePagesPlan("topic-1", undefined, undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("does not call the AI when the claim times out, and surfaces the timeout error", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" });

    const result = await generatePagesPlan("topic-1", undefined, undefined, "run-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/等待超时/);
    expect(runContentTaskMock).not.toHaveBeenCalled();
  });

  it("acquires the claim, calls the AI, and marks the task completed on success", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "acquired" });
    runContentTaskMock.mockResolvedValue(RESOLVED_RESULT);
    queue("content_assets", { data: null, error: null }); // the final insert

    const result = await generatePagesPlan("topic-1", undefined, undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runContentTaskMock).toHaveBeenCalledTimes(1);
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "planning:XIAOHONGSHU");
    expect(failGenerationRunTaskMock).not.toHaveBeenCalled();
  });
});
