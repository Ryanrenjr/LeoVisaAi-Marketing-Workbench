import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canRunCompliance: () => true }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { COMPLIANCE: "compliance" } }));
vi.mock("@/lib/ai/usage-log", () => ({ writeUsageLog: vi.fn().mockResolvedValue({ usageLogFailed: false }) }));
vi.mock("@/lib/status", () => ({ CONTENT_PLATFORM_LABEL: { VIDEO_CHANNEL: "视频号" } }));

const getContentAssetByIdMock = vi.fn();
const getResearchPackByIdMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getContentAssetById: (...args: unknown[]) => getContentAssetByIdMock(...args),
  getResearchPackById: (...args: unknown[]) => getResearchPackByIdMock(...args),
}));

const runComplianceTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runComplianceTask: (...args: unknown[]) => runComplianceTaskMock(...args),
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

const fromMock = vi.fn(() => ({ insert: () => Promise.resolve({ error: null }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { runComplianceReview } from "./compliance-actions";

const RESOLVED_RESULT = {
  ok: true,
  data: { overall_risk: "LOW", findings: [] },
  provider: "ANTHROPIC",
  modelId: "claude",
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 5,
};

/**
 * Live audit finding (P0, round 6): runComplianceReview calls a real
 * billable model. runComplianceStep's existing prefilter (skip assets that
 * already have a compliance_reviews row) closes the retry-level race but
 * not the concurrent-request-level one. These tests cover the atomic-claim
 * wiring, only engaged when runId is supplied.
 */
describe("runComplianceReview — atomic claim wiring (runId provided)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentAssetByIdMock.mockResolvedValue({ id: "asset-1", topic_id: "topic-1", platform: "VIDEO_CHANNEL", content: "text", research_pack_id: "pack-1" });
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1" });
  });

  it("does not call the AI when the claim reports already_completed", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "already_completed" });

    const result = await runComplianceReview("asset-1", undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runComplianceTaskMock).not.toHaveBeenCalled();
  });

  it("does not call the AI when the claim times out, and surfaces the timeout error", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" });

    const result = await runComplianceReview("asset-1", undefined, "run-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/等待超时/);
    expect(runComplianceTaskMock).not.toHaveBeenCalled();
  });

  it("acquires the claim, calls the AI, and marks the task completed on success", async () => {
    claimGenerationRunTaskMock.mockResolvedValue({ outcome: "acquired" });
    runComplianceTaskMock.mockResolvedValue(RESOLVED_RESULT);

    const result = await runComplianceReview("asset-1", undefined, "run-1");

    expect(result).toEqual({ ok: true });
    expect(runComplianceTaskMock).toHaveBeenCalledTimes(1);
    expect(completeGenerationRunTaskMock).toHaveBeenCalledWith("run-1", "compliance:asset-1");
    expect(failGenerationRunTaskMock).not.toHaveBeenCalled();
  });

  it("does not touch the claim at all when runId is omitted (manual re-review from /team/compliance)", async () => {
    runComplianceTaskMock.mockResolvedValue(RESOLVED_RESULT);

    const result = await runComplianceReview("asset-1");

    expect(result).toEqual({ ok: true });
    expect(claimGenerationRunTaskMock).not.toHaveBeenCalled();
  });
});
