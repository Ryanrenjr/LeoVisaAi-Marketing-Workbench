"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getLatestResearchPack, getResearchPackById, getTopicById } from "@/lib/topics";
import { canApproveResearch, canRunResearch } from "@/lib/permissions";
import { canApproveResearchFromStatus, canRunResearchFromStatus } from "@/lib/research-workflow";
import { runResearchTask, runResearchOptimizationTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { canApproveResearchScore, hasScoreData } from "@/lib/ai/research-pack";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { getModel } from "@/lib/ai/providers/registry";
import { writeUsageLog, writeSearchUsageLog } from "@/lib/ai/usage-log";
import type { ModelRef } from "@/lib/ai/providers/types";
import type { ResearchRunType, TopicStatus } from "@/lib/types";

export interface ResearchEditState {
  error: string | null;
}

/**
 * Shown to the operator whenever "优化研究" can't run because the search
 * infrastructure itself is unavailable (no search provider configured, the
 * provider is rate-limited/erroring, or the Model Router couldn't resolve a
 * model for the content or the independent audit call) — a normal user has
 * no use for which provider or router step failed, and shouldn't see it.
 * The real, specific technical detail is still recorded in full in
 * research_runs.error and the research_optimization_failed activity log
 * entry (both admin-facing), never just discarded.
 */
const RESEARCH_OPTIMIZATION_UNAVAILABLE_MESSAGE = "暂时无法继续研究。当前搜索服务不可用，请稍后重试。";

/**
 * Shown for every OTHER optimization failure category — the AI content
 * call, the independent audit call, or saving the result all fail closed
 * the same way from an operator's point of view: nothing changed, the
 * original research is untouched, try again. Deliberately distinct from
 * RESEARCH_OPTIMIZATION_UNAVAILABLE_MESSAGE — conflating "search is down"
 * with "the AI call failed" or "saving failed" told the operator the wrong
 * thing to do next (waiting for search to come back doesn't help a schema-
 * parse or save failure). The real technical detail (provider/router/SQL/
 * stack) is still recorded in full in research_runs.error and the
 * research_optimization_failed activity log entry.
 */
const RESEARCH_OPTIMIZATION_GENERIC_FAILURE_MESSAGE = "本次研究优化未能完成，请重试。原研究结果已保留。";

export interface OptimizeActionState {
  ok: boolean;
  error?: string;
}

/**
 * The mandatory human-approval-gate action for the research stage: routes
 * the RESEARCH task through the Model Router, saves the (already-grounded)
 * pack, and logs both the AI usage and the activity. On success, moves the
 * topic to RESEARCH_READY ("a pack exists, awaiting Expert review") —
 * never further than that; only `approveResearchOnly` below can reach
 * RESEARCH_APPROVED. `override` is the section-9 one-off model choice —
 * it never changes the persisted default in model_routing_config.
 * `runType` defaults to "initial" (a normal run/re-run) — the only other
 * caller, acceptSuggestedTopicRevision, passes "optimization" since a
 * re-research triggered by adopting B's suggested topic revision is still
 * part of that same optimization thread, not an unrelated fresh start.
 */
export async function runResearch(topicId: string, override?: ModelRef | null, runType: ResearchRunType = "initial") {
  const user = await requireUser();
  if (!canRunResearch(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canRunResearchFromStatus(topic.status)) return;
  const fromStatus = topic.status;

  const supabase = await createClient();
  const started = Date.now();
  const { result, searchMeta } = await runResearchTask(topic, override);

  if (searchMeta) {
    await writeSearchUsageLog(supabase, {
      provider: searchMeta.provider,
      digital_employee: TASK_TYPE_EMPLOYEE.RESEARCH,
      task_type: "RESEARCH",
      topic_id: topicId,
      query_count: searchMeta.queryCount,
      result_count: searchMeta.resultCount,
      latency_ms: searchMeta.latencyMs,
      success: searchMeta.success,
      error: searchMeta.error,
    });
  }

  if (isRouterResolutionFailure(result)) {
    // No provider was ever contacted — nothing to log to ai_usage_log,
    // but the ADMIN still needs to see why nothing happened.
    await supabase.from("research_runs").insert({
      topic_id: topicId,
      status: "failed",
      run_type: runType,
      model_alias: "unresolved",
      requested_by: user.id,
      completed_at: new Date().toISOString(),
      error: result.error,
    });
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_run_failed",
      actor_id: user.id,
      detail: { error: result.error },
    });
    revalidatePath(`/topics/${topicId}`);
    return;
  }

  const { data: run, error: runInsertError } = await supabase
    .from("research_runs")
    .insert({
      topic_id: topicId,
      status: "running",
      run_type: runType,
      model_alias: `${result.provider}/${result.modelId}`,
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (runInsertError || !run) return;

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_run_started",
    actor_id: user.id,
  });

  const model = getModel(result.provider, result.modelId);

  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "research",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "RESEARCH",
    digital_employee: TASK_TYPE_EMPLOYEE.RESEARCH,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok) {
    await supabase
      .from("research_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: result.error })
      .eq("id", run.id);

    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_run_failed",
      actor_id: user.id,
      detail: { error: result.error, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
    });

    revalidatePath(`/topics/${topicId}`);
    return;
  }
  if (!result.data) return;
  const resultPack = result.data;

  // Hard gate: RESEARCH_READY must mean "at least one real, grounded
  // source exists" — groundSources() (research-pack.ts) can legitimately
  // drop every claimed source (the model cited a URL the search tool never
  // actually returned), leaving resultPack.sources empty even though the
  // AI call itself succeeded. Checked before research_packs is ever
  // inserted, so there's nothing to compensating-delete — the simplest way
  // to guarantee no half-state pack is left behind.
  if (resultPack.sources.length === 0) {
    await supabase
      .from("research_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: "研究结果没有任何经过真实搜索验证的来源，无法进入审核阶段。",
      })
      .eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_run_failed",
      actor_id: user.id,
      detail: { error: "研究结果没有任何经过真实搜索验证的来源，无法进入审核阶段。", stage: "grounding" },
    });
    revalidatePath(`/topics/${topicId}`);
    return;
  }

  // Fail-closed evidence chain: a topic must never reach RESEARCH_READY
  // unless the pack AND its sources are both confirmed persisted. No
  // multi-statement DB transaction here (Supabase JS doesn't support one
  // without a new RPC function) — instead, each write is checked in order,
  // and a pack that ends up without its sources is compensating-deleted
  // rather than left behind looking like complete evidence.
  const { data: pack, error: packInsertError } = await supabase
    .from("research_packs")
    .insert({
      research_run_id: run.id,
      topic_id: topicId,
      summary: resultPack.summary,
      key_findings: resultPack.keyFindings,
      warnings: resultPack.warnings,
      confidence: resultPack.confidence,
      score_total: resultPack.scoreTotal,
      score_breakdown: resultPack.scoreBreakdown,
    })
    .select("id")
    .single();

  if (packInsertError || !pack) {
    await supabase
      .from("research_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: `保存研究结果失败：${packInsertError?.message ?? ""}`,
      })
      .eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_run_failed",
      actor_id: user.id,
      detail: { error: packInsertError?.message, stage: "research_packs" },
    });
    revalidatePath(`/topics/${topicId}`);
    return;
  }

  if (resultPack.sources.length > 0) {
    const { error: sourcesInsertError } = await supabase.from("research_sources").insert(
      resultPack.sources.map((s) => ({
        research_pack_id: pack.id,
        title: s.title,
        url: s.url,
        note: s.note,
        page_age: s.pageAge,
      })),
    );

    if (sourcesInsertError) {
      // Compensating rollback — a pack with no sources looks like complete
      // evidence but isn't; don't leave it behind for a human to trust.
      await supabase.from("research_packs").delete().eq("id", pack.id);
      await supabase
        .from("research_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: `保存研究来源失败：${sourcesInsertError.message}`,
        })
        .eq("id", run.id);
      await supabase.from("topic_activity_log").insert({
        topic_id: topicId,
        activity_type: "research_run_failed",
        actor_id: user.id,
        detail: { error: sourcesInsertError.message, stage: "research_sources" },
      });
      revalidatePath(`/topics/${topicId}`);
      return;
    }
  }

  await supabase
    .from("research_runs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", run.id);

  const toStatus: TopicStatus = "RESEARCH_READY";
  let statusAdvanceFailed: string | undefined;
  if (fromStatus !== toStatus) {
    const { error: statusUpdateError } = await supabase
      .from("topics")
      .update({ status: toStatus })
      .eq("id", topicId)
      .eq("status", fromStatus);

    if (statusUpdateError) {
      statusAdvanceFailed = statusUpdateError.message;
    } else {
      await supabase.from("topic_status_events").insert({
        topic_id: topicId,
        from_status: fromStatus,
        to_status: toStatus,
        approved_by: user.id,
      });
    }
  }

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_run_completed",
    actor_id: user.id,
    detail: {
      sourceCount: resultPack.sources.length,
      confidence: resultPack.confidence,
      scoreTotal: resultPack.scoreTotal,
      latencyMs: Date.now() - started,
      ...(usageLogFailed ? { usageLogFailed: true } : {}),
      ...(statusAdvanceFailed ? { statusAdvanceFailed } : {}),
    },
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}

/**
 * Edits the narrative fields of a research pack. Deliberately does NOT
 * allow editing/adding sources — sources only ever come from the
 * grounded agent output (see src/lib/ai/research-pack.ts), so a human
 * can't reintroduce an unverified URL through the edit form.
 */
export async function editResearchPack(
  packId: string,
  topicId: string,
  _prevState: ResearchEditState,
  formData: FormData,
): Promise<ResearchEditState> {
  const user = await requireUser();
  if (!canRunResearch(user.role)) return { error: "仅 ADMIN 可编辑研究成果。" };

  const summary = String(formData.get("summary") ?? "").trim();
  const keyFindingsRaw = String(formData.get("key_findings") ?? "");
  const warnings = String(formData.get("warnings") ?? "").trim();

  if (!summary) return { error: "摘要不能为空。" };

  const keyFindings = keyFindingsRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const supabase = await createClient();
  const { error } = await supabase
    .from("research_packs")
    .update({
      summary,
      key_findings: keyFindings,
      warnings,
      edited_by: user.id,
      edited_at: new Date().toISOString(),
    })
    .eq("id", packId);

  if (error) return { error: "保存失败，请重试。" };

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_edited",
    actor_id: user.id,
  });

  revalidatePath(`/topics/${topicId}`);
  redirect(`/topics/${topicId}`);
}

/**
 * The mandatory human-approval-gate write itself — RESEARCH_READY →
 * RESEARCH_APPROVED, deliberately never further (advancing past that
 * needs Content/Compliance, which happen afterward, not here). No
 * redirect, so `pipeline-actions.ts`'s `confirmAndGenerateAll` — the
 * only caller, bound to the actual "通过" buttons — can chain content
 * generation right after this and redirect somewhere else entirely; a
 * function that redirects can't safely be called as a sub-step of
 * another action, since `redirect()` aborts the caller immediately.
 *
 * Atomic (live audit finding, round 7): this used to insert
 * research_approvals, then update topics.status WITHOUT checking the
 * error or affected-row count, then unconditionally insert a
 * topic_status_events row and return true — a concurrent status change
 * (or a transient error on just that one statement) could leave a fake
 * "approved" status event on record while the topic's real status never
 * moved, and the caller would still redirect straight into content
 * generation believing approval succeeded. Delegated to
 * `approve_research()` (see supabase/migrations/0029_approve_research_rpc.sql,
 * 0036_research_optimization_and_score_gate.sql), which does the whole
 * sequence — lock the topic row, assert its status, verify the pack
 * belongs to it, check its score meets the 80-point threshold, insert the
 * approval, advance the status (confirming exactly one row changed),
 * record the status event — as one Postgres transaction. Any failure rolls
 * back everything; this function only returns true once that transaction
 * has actually committed.
 *
 * The score check and the "is this actually the latest pack" check below
 * both duplicate checks the RPC itself also makes (0036) — deliberately:
 * they fail fast without a round-trip for the overwhelmingly common case
 * (the UI simply doesn't render "通过，开始生成" below 80, and always binds
 * this action to whatever pack it just rendered as "latest" — see
 * research-pack-view.tsx / research-decision-actions.tsx), while the RPC's
 * checks are the ones that actually can't be bypassed — a direct call to
 * the RPC (skipping this function entirely) still hits them. Neither
 * layer alone would satisfy "not just a UI gate"; this one is a
 * convenience, not the boundary.
 *
 * The "latest pack" check specifically matters because a topic can
 * accumulate several research_packs rows over time (initial + N
 * optimization passes — see research_runs.run_type) — a stale browser tab
 * still showing an old pack (e.g. one that scored 85 before a later
 * optimization pass re-scored it at 72) must not be able to approve that
 * superseded id after the fact just because the tab was never refreshed.
 */
export async function approveResearchOnly(topicId: string, researchPackId: string): Promise<boolean> {
  const user = await requireUser();
  if (!canApproveResearch(user.role)) throw new Error("Forbidden: EXPERT role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canApproveResearchFromStatus(topic.status)) return false;

  const [pack, latestPack] = await Promise.all([getResearchPackById(researchPackId), getLatestResearchPack(topicId)]);
  if (!pack || pack.topic_id !== topicId || !canApproveResearchScore(pack.score_total)) return false;
  if (!latestPack || latestPack.id !== researchPackId) return false;

  const supabase = await createClient();

  const { error } = await supabase.rpc("approve_research", {
    p_topic_id: topicId,
    p_research_pack_id: researchPackId,
    p_decided_by: user.id,
  });
  if (error) return false;

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_approved",
    actor_id: user.id,
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
  revalidatePath("/research-completed");
  return true;
}

/**
 * B｜政策研究员's "研究优化" mode (docs/ai-workflows.md "研究优化") — a
 * targeted follow-up pass over the CURRENT latest research pack, aimed at
 * whatever actually scored low last time (see
 * src/lib/ai/research-optimization.ts), not a repeat of the same cold-
 * start search. Produces a brand-new, independently-scored research_packs
 * row; the previous pack is never touched or deleted — getLatestResearchPack
 * already surfaces "whichever pack is newest" for a topic, the same
 * mechanism a second manual "运行研究" click already relies on, so history
 * comes for free with no extra schema.
 *
 * Only valid from RESEARCH_READY — optimizing refines an existing pack, it
 * doesn't start research from IDEA. Deliberately never touches
 * topics.status: this is a same-stage refinement, not a pipeline
 * transition, so a topic mid-optimization is never in an ambiguous status.
 * ADMIN-only, same gate as runResearch (this is still B's work, just its
 * second-stage mode).
 */
export async function optimizeResearch(topicId: string, override?: ModelRef | null): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canRunResearch(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canApproveResearchFromStatus(topic.status)) {
    return { ok: false, error: "这个选题当前不在可以优化研究的状态。" };
  }

  const previousPack = await getLatestResearchPack(topicId);
  if (!previousPack || !hasScoreData(previousPack.score_breakdown)) {
    return { ok: false, error: "还没有可以优化的研究结果。" };
  }

  const supabase = await createClient();
  const started = Date.now();

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_optimization_started",
    actor_id: user.id,
    detail: { fromScore: previousPack.score_total },
  });

  const { result, searchMeta, auditUsage, failureReason } = await runResearchOptimizationTask(
    topic,
    {
      summary: previousPack.summary,
      keyFindings: previousPack.key_findings,
      warnings: previousPack.warnings,
      confidence: previousPack.confidence,
      scoreBreakdown: previousPack.score_breakdown,
    },
    override,
  );

  // The independent audit (see research-optimization.ts / router.ts) is a
  // genuinely separate model call from `result` below — logged as its own
  // ai_usage_log row under RESEARCH_AUDIT, same "one row per real model
  // call" convention every other workflow follows. Logged unconditionally
  // whenever it actually ran (even if the content call that preceded it
  // somehow also failed after all — auditUsage is only ever null when the
  // audit call was never dispatched at all).
  if (auditUsage) {
    const auditModel = getModel(auditUsage.provider, auditUsage.modelId);
    await writeUsageLog(supabase, {
      workflow_type: "research_optimization",
      model_alias: `${auditUsage.provider}/${auditUsage.modelId}`,
      topic_id: topicId,
      input_tokens: auditUsage.inputTokens,
      output_tokens: auditUsage.outputTokens,
      latency_ms: auditUsage.latencyMs,
      success: auditUsage.ok,
      error: auditUsage.error,
      provider: auditUsage.provider,
      task_type: "RESEARCH_AUDIT",
      digital_employee: TASK_TYPE_EMPLOYEE.RESEARCH_AUDIT,
      pricing_type_at_execution: auditModel?.pricingType ?? null,
    });
  }

  if (searchMeta) {
    await writeSearchUsageLog(supabase, {
      provider: searchMeta.provider,
      digital_employee: TASK_TYPE_EMPLOYEE.RESEARCH,
      task_type: "RESEARCH",
      topic_id: topicId,
      query_count: searchMeta.queryCount,
      result_count: searchMeta.resultCount,
      latency_ms: searchMeta.latencyMs,
      success: searchMeta.success,
      error: searchMeta.error,
    });
  }

  if (isRouterResolutionFailure(result)) {
    // No provider was ever contacted — nothing to log to ai_usage_log, and
    // (unlike runResearch) nothing to compensating-clean-up either: the
    // previous pack was never touched, so the topic is exactly where it
    // was before this click. `result.error` here is an infrastructure-level
    // detail (which search provider / model router failed and why) — real,
    // useful for an ADMIN, but not something to show a normal operator on
    // the page. It's recorded in full in research_runs.error and this
    // activity log entry (both admin-facing, see /admin), while the
    // returned error is the generic, sanitized message the UI actually
    // renders.
    await supabase.from("research_runs").insert({
      topic_id: topicId,
      status: "failed",
      run_type: "optimization",
      model_alias: "unresolved",
      requested_by: user.id,
      completed_at: new Date().toISOString(),
      error: result.error,
    });
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_optimization_failed",
      actor_id: user.id,
      detail: { error: result.error },
    });
    revalidatePath(`/topics/${topicId}`);
    return {
      ok: false,
      error:
        failureReason === "SEARCH_UNAVAILABLE"
          ? RESEARCH_OPTIMIZATION_UNAVAILABLE_MESSAGE
          : RESEARCH_OPTIMIZATION_GENERIC_FAILURE_MESSAGE,
    };
  }

  const { data: run, error: runInsertError } = await supabase
    .from("research_runs")
    .insert({
      topic_id: topicId,
      status: "running",
      run_type: "optimization",
      model_alias: `${result.provider}/${result.modelId}`,
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (runInsertError || !run) return { ok: false, error: "无法创建优化研究记录，请重试。" };

  const model = getModel(result.provider, result.modelId);
  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "research_optimization",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "RESEARCH",
    digital_employee: TASK_TYPE_EMPLOYEE.RESEARCH,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    await supabase
      .from("research_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: result.error })
      .eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_optimization_failed",
      actor_id: user.id,
      detail: { error: result.error, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
    });
    revalidatePath(`/topics/${topicId}`);
    return { ok: false, error: RESEARCH_OPTIMIZATION_GENERIC_FAILURE_MESSAGE };
  }
  const resultPack = result.data;

  // Same hard gate as runResearch: an optimization pass that grounds down
  // to zero real sources produced nothing usable, and must not silently
  // become "the new latest pack" with no evidence behind it.
  if (resultPack.sources.length === 0) {
    const error = "优化研究没有任何经过真实搜索验证的来源，无法生成新的研究结果。";
    await supabase.from("research_runs").update({ status: "failed", completed_at: new Date().toISOString(), error }).eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_optimization_failed",
      actor_id: user.id,
      detail: { error, stage: "grounding" },
    });
    revalidatePath(`/topics/${topicId}`);
    return { ok: false, error };
  }

  const { data: pack, error: packInsertError } = await supabase
    .from("research_packs")
    .insert({
      research_run_id: run.id,
      topic_id: topicId,
      summary: resultPack.summary,
      key_findings: resultPack.keyFindings,
      warnings: resultPack.warnings,
      confidence: resultPack.confidence,
      score_total: resultPack.scoreTotal,
      score_breakdown: resultPack.scoreBreakdown,
      suggested_topic_revision: resultPack.suggestedTopicRevision,
    })
    .select("id")
    .single();

  if (packInsertError || !pack) {
    const error = `保存优化研究结果失败：${packInsertError?.message ?? ""}`;
    await supabase.from("research_runs").update({ status: "failed", completed_at: new Date().toISOString(), error }).eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_optimization_failed",
      actor_id: user.id,
      detail: { error: packInsertError?.message, stage: "research_packs" },
    });
    revalidatePath(`/topics/${topicId}`);
    return { ok: false, error: RESEARCH_OPTIMIZATION_GENERIC_FAILURE_MESSAGE };
  }

  const { error: sourcesInsertError } = await supabase.from("research_sources").insert(
    resultPack.sources.map((s) => ({
      research_pack_id: pack.id,
      title: s.title,
      url: s.url,
      note: s.note,
      page_age: s.pageAge,
    })),
  );

  if (sourcesInsertError) {
    // Compensating rollback — same reasoning as runResearch: a pack with
    // no sources looks like complete evidence but isn't. The PREVIOUS
    // pack (what the user had before clicking "优化研究") is untouched
    // either way, so this failure never leaves the topic worse off.
    await supabase.from("research_packs").delete().eq("id", pack.id);
    const error = `保存优化研究来源失败：${sourcesInsertError.message}`;
    await supabase.from("research_runs").update({ status: "failed", completed_at: new Date().toISOString(), error }).eq("id", run.id);
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_optimization_failed",
      actor_id: user.id,
      detail: { error: sourcesInsertError.message, stage: "research_sources" },
    });
    revalidatePath(`/topics/${topicId}`);
    return { ok: false, error: RESEARCH_OPTIMIZATION_GENERIC_FAILURE_MESSAGE };
  }

  await supabase.from("research_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", run.id);

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_optimization_completed",
    actor_id: user.id,
    detail: {
      fromScore: previousPack.score_total,
      toScore: resultPack.scoreTotal,
      latencyMs: Date.now() - started,
      ...(usageLogFailed ? { usageLogFailed: true } : {}),
    },
  });

  if (resultPack.suggestedTopicRevision) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "research_topic_revision_suggested",
      actor_id: user.id,
      detail: { suggestedTitle: resultPack.suggestedTopicRevision.title, reason: resultPack.suggestedTopicRevision.reason },
    });
  }

  revalidatePath(`/topics/${topicId}`);
  revalidatePath(`/topics/${topicId}/research/review`);
  return { ok: true };
}

/**
 * The human decision point for B's "suggested_topic_revision" (研究优化
 * RESULT 2 in docs/ai-workflows.md — the evidence is fine, but the topic's
 * own title/question claims more certainty than the evidence supports).
 * Never applied automatically; only reachable via an explicit "采用建议并
 * 重新研究" click. Updates the topic's title/question(/audience), records
 * the decision (before/after, and why), then re-runs research on the now-
 * revised topic — reusing runResearch wholesale (tagged "optimization"
 * since this is still part of the same optimization thread) rather than a
 * second, parallel research-running code path.
 *
 * Live audit finding: this always changes title/question (and this
 * function's own gate above already requires the topic to be at
 * RESEARCH_READY) — so it always invalidates the pack that's about to
 * become stale. The topic is moved back to RESEARCHING as part of THIS
 * same update, before runResearch ever runs, so the existing RESEARCH_READY-
 * only approval gate (canApproveResearchFromStatus / approve_research's own
 * status check) makes the still-latest-but-now-stale old pack unapprovable
 * for the whole re-research window — not a new check, the existing one now
 * actually sees the true state. If runResearch fails, it never touches
 * topics.status on its own failure paths, so the topic simply stays at
 * RESEARCHING (new title/question kept, old pack kept, nothing approvable)
 * until a human retries — never silently reverts to RESEARCH_READY.
 */
export async function acceptSuggestedTopicRevision(
  topicId: string,
  researchPackId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canRunResearch(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canApproveResearchFromStatus(topic.status)) {
    return { ok: false, error: "这个选题当前不在可以修改选题的状态。" };
  }

  const pack = await getResearchPackById(researchPackId);
  if (!pack || pack.topic_id !== topicId || !pack.suggested_topic_revision) {
    return { ok: false, error: "没有找到可以采用的选题修改建议。" };
  }

  const { title, question, audience, reason } = pack.suggested_topic_revision;
  const supabase = await createClient();
  // audience is optional on the suggestion — B only proposes one when the
  // audience itself over-scoped the claim (see research-optimization.ts's
  // OPTIMIZATION_ADDENDUM). When it's null, topics.audience is left exactly
  // as-is rather than being overwritten with nothing.
  const { error: updateError } = await supabase
    .from("topics")
    .update(audience ? { title, question, audience, status: "RESEARCHING" } : { title, question, status: "RESEARCHING" })
    .eq("id", topicId);
  if (updateError) return { ok: false, error: `更新选题失败：${updateError.message}` };

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: "RESEARCH_READY",
    to_status: "RESEARCHING",
    approved_by: user.id,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_topic_revision_accepted",
    actor_id: user.id,
    detail: {
      previousTitle: topic.title,
      newTitle: title,
      previousQuestion: topic.question,
      newQuestion: question,
      ...(audience ? { previousAudience: topic.audience, newAudience: audience } : {}),
      reason,
    },
  });

  revalidatePath(`/topics/${topicId}`);
  await runResearch(topicId, undefined, "optimization");
  return { ok: true };
}

/**
 * `useActionState`-compatible wrappers around optimizeResearch /
 * acceptSuggestedTopicRevision — same pattern editResearchPack /
 * ResearchEditForm already establishes (a `(prevState, formData)` shaped
 * action, reading its real arguments back out of hidden form fields) so
 * OptimizeResearchButton (src/components/research-decision-actions.tsx)
 * can actually show a failure to the operator instead of the previous
 * behavior — a plain `<form action={fn.bind(...)}>` whose return value
 * nothing ever read, so a failed "优化研究" click looked exactly like
 * nothing happened at all.
 */
export async function optimizeResearchAction(_prevState: OptimizeActionState, formData: FormData): Promise<OptimizeActionState> {
  const topicId = String(formData.get("topicId") ?? "");
  return optimizeResearch(topicId);
}

export async function acceptSuggestedTopicRevisionAction(
  _prevState: OptimizeActionState,
  formData: FormData,
): Promise<OptimizeActionState> {
  const topicId = String(formData.get("topicId") ?? "");
  const researchPackId = String(formData.get("researchPackId") ?? "");
  return acceptSuggestedTopicRevision(topicId, researchPackId);
}

