import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server-only unconditionally throws outside Next's bundler — stubbed for tests (see content-agent.test.ts).
vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("./supabase/server", () => ({ createClient: async () => ({ rpc: rpcMock, from: fromMock }) }));

function rpcResult(result: { acquired: boolean; status: string; error?: string | null }) {
  return { single: () => Promise.resolve({ data: { ...result, error: result.error ?? null }, error: null }) };
}

import { claimGenerationRunTask, completeGenerationRunTask, failGenerationRunTask } from "./generation-run-tasks";

/**
 * Live audit finding (P0, round 6): the since-based idempotency built up
 * over several earlier rounds has a race window — two requests can both
 * read "not generated yet" before either writes, and both call a paid AI
 * provider. claimGenerationRunTask (backed by the claim_generation_run_task
 * Postgres function, see supabase/migrations/0028_generation_run_tasks.sql)
 * is what closes that window at the TypeScript-orchestration level. True
 * atomicity is a Postgres-level guarantee this file's mocked-client tests
 * cannot verify — see the live concurrency script used to check that
 * separately (not part of this test file).
 */
describe("claimGenerationRunTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to acquired immediately when the RPC reports it won the claim", async () => {
    rpcMock.mockReturnValue(rpcResult({ acquired: true, status: "running" }));

    const outcome = await claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL");

    expect(outcome).toEqual({ outcome: "acquired" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("claim_generation_run_task", {
      p_run_id: "run-1",
      p_task_key: "content:VIDEO_CHANNEL",
      p_lease_seconds: 120,
    });
  });

  it("resolves to already_completed immediately, without polling, when the task is done", async () => {
    rpcMock.mockReturnValue(rpcResult({ acquired: false, status: "completed" }));

    const outcome = await claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL");

    expect(outcome).toEqual({ outcome: "already_completed" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("polls (does not immediately fail) while the task is running with a valid lease, then acquires once the lease is stolen", async () => {
    rpcMock
      .mockReturnValueOnce(rpcResult({ acquired: false, status: "running" }))
      .mockReturnValueOnce(rpcResult({ acquired: false, status: "running" }))
      .mockReturnValueOnce(rpcResult({ acquired: true, status: "running" }));

    const promise = claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await promise;

    expect(outcome).toEqual({ outcome: "acquired" });
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("polls while running, then reports already_completed once it sees the original holder finished", async () => {
    rpcMock
      .mockReturnValueOnce(rpcResult({ acquired: false, status: "running" }))
      .mockReturnValueOnce(rpcResult({ acquired: false, status: "completed" }));

    const promise = claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL");
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await promise;

    expect(outcome).toEqual({ outcome: "already_completed" });
  });

  it("never calls the caller back as acquired/completed if the task stays running past the max wait — returns timed_out with a real error instead of hanging or proceeding", async () => {
    rpcMock.mockReturnValue(rpcResult({ acquired: false, status: "running" }));

    const promise = claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL");
    // Lease (120s) + buffer (10s) — advance well past it.
    await vi.advanceTimersByTimeAsync(140_000);
    const outcome = await promise;

    expect(outcome.outcome).toBe("timed_out");
    expect((outcome as { error: string }).error).toMatch(/等待超时/);
  });

  it("throws if the RPC call itself errors, rather than treating it as any claim outcome", async () => {
    rpcMock.mockReturnValue({ single: () => Promise.resolve({ data: null, error: { message: "connection reset" } }) });

    await expect(claimGenerationRunTask("run-1", "content:VIDEO_CHANNEL")).rejects.toThrow(/获取任务锁失败/);
  });
});

/**
 * Both are deliberately best-effort — by the time either is called, the
 * real business write (content_assets / content_images / compliance_reviews
 * row) has already succeeded, so a bookkeeping-table failure here must not
 * be reported back as a failure of the whole operation. The since-based
 * check at each call site is what recovers from this specific failure mode
 * on the next retry.
 */
describe("completeGenerationRunTask / failGenerationRunTask — best-effort, never throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("completeGenerationRunTask does not throw when the update errors", async () => {
    fromMock.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: "db down" } }) }) }) }),
    });

    await expect(completeGenerationRunTask("run-1", "content:VIDEO_CHANNEL")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("failGenerationRunTask does not throw when the update errors", async () => {
    fromMock.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: "db down" } }) }) }) }),
    });

    await expect(failGenerationRunTask("run-1", "content:VIDEO_CHANNEL", "boom")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("completeGenerationRunTask resolves cleanly on success, without warning", async () => {
    fromMock.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
    });

    await expect(completeGenerationRunTask("run-1", "content:VIDEO_CHANNEL")).resolves.toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
