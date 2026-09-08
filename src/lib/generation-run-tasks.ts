import "server-only";
import { createClient } from "./supabase/server";

/**
 * Atomic claim for one billable AI subtask within a `generation_runs` row
 * (see supabase/migrations/0028_generation_run_tasks.sql for the schema
 * and the `claim_generation_run_task` Postgres function this wraps).
 *
 * Live audit finding (P0): the since-based idempotency built up over
 * several earlier rounds ("SELECT the business table, decide in JS, then
 * call the AI") has a race window — two tabs, or a stale in-flight
 * request plus a fresh one after a refresh, can both read "not generated
 * yet" before either writes, and both go on to call a paid provider for
 * the same subtask. This module closes that window: every billable call
 * site must win `claimGenerationRunTask` before calling a provider.
 * since-based checks stay in place as a second layer — they still catch
 * "the AI succeeded but this ledger write failed", see
 * `completeGenerationRunTask`'s doc comment below.
 *
 * `task_key` convention (caller's responsibility, not enforced here):
 * `content:<platform>`, `content:XIAOHONGSHU:pages`, `image:video_cover`,
 * `image:wechat_cover`, `carousel:<pageIndex>`, `compliance:<contentAssetId>`,
 * `revision:<contentAssetId>`.
 */

/**
 * How long a claim is valid before another request may steal it as
 * abandoned (crash recovery). Single AI calls in this codebase (content/
 * image/compliance/revision) normally finish, including persistence, in
 * low tens of seconds at most (the only real signal available is
 * ai_usage_log's latency_ms, which never shows anything close to a
 * minute) — 120s gives 2-4x headroom over that so a merely-slow request
 * is never prematurely preempted, while still bounding how long a truly
 * crashed process can leave a subtask stuck before the next click/retry
 * can pick it back up without manual DB intervention.
 */
const LEASE_SECONDS = 120;

/** How often a waiting request re-checks whether it can now acquire the claim (the original holder finished, or the lease expired). Not a queue — just the same idempotent RPC called again on an interval, same pattern as this codebase's existing withStepRetry/waitIfPaused. */
const POLL_INTERVAL_MS = 3000;

/** A bit longer than one full lease — by then the original holder has either finished (we'll see status flip to completed/failed on our next poll) or its lease has expired (we can steal it ourselves on our next poll). Actually hitting this should only happen if that assumption breaks (e.g. meaningful clock skew) — surfaced as a real error, never silently ignored. */
const MAX_WAIT_MS = LEASE_SECONDS * 1000 + 10_000;

export type ClaimOutcome =
  | { outcome: "acquired" }
  | { outcome: "already_completed" }
  | { outcome: "timed_out"; error: string };

interface ClaimRow {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  claimed_at: string | null;
  lease_until: string | null;
  completed_at: string | null;
  error: string | null;
  acquired: boolean;
}

/**
 * Attempts to claim `taskKey` under `runId`, waiting (bounded) if someone
 * else currently holds a still-valid lease on it, rather than either
 * calling the provider anyway or failing immediately on a quick refresh.
 */
export async function claimGenerationRunTask(runId: string, taskKey: string): Promise<ClaimOutcome> {
  const supabase = await createClient();
  const deadline = Date.now() + MAX_WAIT_MS;

  for (;;) {
    const { data, error } = await supabase
      .rpc("claim_generation_run_task", { p_run_id: runId, p_task_key: taskKey, p_lease_seconds: LEASE_SECONDS })
      .single<ClaimRow>();
    if (error) throw new Error(`获取任务锁失败：${error.message}`);

    if (data.acquired) return { outcome: "acquired" };
    if (data.status === "completed") return { outcome: "already_completed" };

    if (Date.now() >= deadline) {
      return { outcome: "timed_out", error: "另一个请求仍在处理这一项，等待超时，请稍后重试。" };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Marks a claimed task done — best-effort, deliberately never throws.
 * By the time this is called, the real business write (content_assets /
 * content_images / compliance_reviews row) has already succeeded; a
 * failure to update this bookkeeping table must not turn that real
 * success into a reported failure. The since-based check at each call
 * site is what recovers from this specific failure mode on the next
 * retry — it reads the business table directly, not this ledger.
 */
export async function completeGenerationRunTask(runId: string, taskKey: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("generation_run_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("task_key", taskKey)
      .eq("status", "running");
    if (error) console.warn(`[generation-run-tasks] failed to mark ${taskKey} completed:`, error.message);
  } catch (err) {
    console.warn(`[generation-run-tasks] failed to mark ${taskKey} completed:`, err);
  }
}

/** Same best-effort-only posture as completeGenerationRunTask — see its doc comment. */
export async function failGenerationRunTask(runId: string, taskKey: string, error: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { error: updateError } = await supabase
      .from("generation_run_tasks")
      .update({ status: "failed", error, updated_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("task_key", taskKey)
      .eq("status", "running");
    if (updateError) console.warn(`[generation-run-tasks] failed to mark ${taskKey} failed:`, updateError.message);
  } catch (err) {
    console.warn(`[generation-run-tasks] failed to mark ${taskKey} failed:`, err);
  }
}
