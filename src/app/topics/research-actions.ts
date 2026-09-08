"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getTopicById } from "@/lib/topics";
import { canApproveResearch, canRunResearch } from "@/lib/permissions";
import { canApproveResearchFromStatus, canRunResearchFromStatus } from "@/lib/research-workflow";
import { runResearchTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { getModel } from "@/lib/ai/providers/registry";
import { writeUsageLog, writeSearchUsageLog } from "@/lib/ai/usage-log";
import type { ModelRef } from "@/lib/ai/providers/types";
import type { TopicStatus } from "@/lib/types";

export interface ResearchEditState {
  error: string | null;
}

/**
 * The mandatory human-approval-gate action for the research stage: routes
 * the RESEARCH task through the Model Router, saves the (already-grounded)
 * pack, and logs both the AI usage and the activity. On success, moves the
 * topic to RESEARCH_READY ("a pack exists, awaiting Expert review") —
 * never further than that; only `approveResearchOnly` below can reach
 * RESEARCH_APPROVED. `override` is the section-9 one-off model choice —
 * it never changes the persisted default in model_routing_config.
 */
export async function runResearch(topicId: string, override?: ModelRef | null) {
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
 */
export async function approveResearchOnly(topicId: string, researchPackId: string): Promise<boolean> {
  const user = await requireUser();
  if (!canApproveResearch(user.role)) throw new Error("Forbidden: EXPERT role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canApproveResearchFromStatus(topic.status)) return false;

  const supabase = await createClient();

  const { error: approvalError } = await supabase.from("research_approvals").insert({
    topic_id: topicId,
    research_pack_id: researchPackId,
    decision: "approved",
    decided_by: user.id,
  });
  if (approvalError) return false;

  await supabase
    .from("topics")
    .update({ status: "RESEARCH_APPROVED" })
    .eq("id", topicId)
    .eq("status", "RESEARCH_READY");

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: "RESEARCH_READY",
    to_status: "RESEARCH_APPROVED",
    approved_by: user.id,
  });

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

