"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getTopicById } from "@/lib/topics";
import { canApproveResearch, canRunResearch } from "@/lib/permissions";
import {
  canApproveResearchFromStatus,
  canRequestResearchChangesFromStatus,
  canRunResearchFromStatus,
} from "@/lib/research-workflow";
import { runResearchAgent, researchAgentModelAlias } from "@/lib/ai/research-agent";
import type { TopicStatus } from "@/lib/types";

export interface ResearchEditState {
  error: string | null;
}

/**
 * The mandatory human-approval-gate action for the research stage: runs
 * the Research Agent, saves the (already-grounded) pack, and logs both
 * the AI usage and the activity. On success, moves the topic to
 * RESEARCH_READY ("a pack exists, awaiting Expert review") — never
 * further than that; only approveResearch can reach RESEARCH_APPROVED.
 */
export async function runResearch(topicId: string) {
  const user = await requireUser();
  if (!canRunResearch(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canRunResearchFromStatus(topic.status)) return;
  const fromStatus = topic.status;

  const supabase = await createClient();
  const modelAlias = researchAgentModelAlias();

  const { data: run, error: runInsertError } = await supabase
    .from("research_runs")
    .insert({ topic_id: topicId, status: "running", model_alias: modelAlias, requested_by: user.id })
    .select("id")
    .single();
  if (runInsertError || !run) return;

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_run_started",
    actor_id: user.id,
  });

  const started = Date.now();
  const result = await runResearchAgent(topic);

  await supabase.from("ai_usage_log").insert({
    workflow_type: "research",
    model_alias: result.modelAlias,
    topic_id: topicId,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
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
      detail: { error: result.error },
    });

    revalidatePath(`/topics/${topicId}`);
    return;
  }

  await supabase
    .from("research_runs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", run.id);

  const { data: pack, error: packInsertError } = await supabase
    .from("research_packs")
    .insert({
      research_run_id: run.id,
      topic_id: topicId,
      summary: result.pack.summary,
      key_findings: result.pack.keyFindings,
      warnings: result.pack.warnings,
      confidence: result.pack.confidence,
    })
    .select("id")
    .single();

  if (!packInsertError && pack && result.pack.sources.length > 0) {
    await supabase.from("research_sources").insert(
      result.pack.sources.map((s) => ({
        research_pack_id: pack.id,
        title: s.title,
        url: s.url,
        note: s.note,
        page_age: s.pageAge,
      })),
    );
  }

  const toStatus: TopicStatus = "RESEARCH_READY";
  if (fromStatus !== toStatus) {
    await supabase
      .from("topics")
      .update({ status: toStatus })
      .eq("id", topicId)
      .eq("status", fromStatus);

    await supabase.from("topic_status_events").insert({
      topic_id: topicId,
      from_status: fromStatus,
      to_status: toStatus,
      approved_by: user.id,
    });
  }

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_run_completed",
    actor_id: user.id,
    detail: {
      sourceCount: result.pack.sources.length,
      confidence: result.pack.confidence,
      latencyMs: Date.now() - started,
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
 * The mandatory human-approval-gate action itself. Ends at
 * RESEARCH_APPROVED — deliberately never READY_TO_SHOOT or anything
 * further; advancing past RESEARCH_APPROVED needs the (not yet built)
 * Content AI / Compliance / Leo review stages.
 */
export async function approveResearch(topicId: string, researchPackId: string) {
  const user = await requireUser();
  if (!canApproveResearch(user.role)) throw new Error("Forbidden: EXPERT role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canApproveResearchFromStatus(topic.status)) return;

  const supabase = await createClient();

  const { error: approvalError } = await supabase.from("research_approvals").insert({
    topic_id: topicId,
    research_pack_id: researchPackId,
    decision: "approved",
    decided_by: user.id,
  });
  if (approvalError) return;

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
}

/**
 * Sends a pack back for rework: RESEARCH_READY → RESEARCHING, so the
 * ADMIN knows another run/edit is expected before the Expert reviews
 * again. This is a real status transition (unlike the previous
 * milestone, where "request changes" only logged an activity entry).
 */
export async function requestResearchChanges(
  topicId: string,
  researchPackId: string,
  formData: FormData,
) {
  const user = await requireUser();
  if (!canApproveResearch(user.role)) throw new Error("Forbidden: EXPERT role required");

  const topic = await getTopicById(topicId);
  if (!topic || !canRequestResearchChangesFromStatus(topic.status)) return;

  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.from("research_approvals").insert({
    topic_id: topicId,
    research_pack_id: researchPackId,
    decision: "changes_requested",
    decided_by: user.id,
    note: note || null,
  });
  if (error) return;

  await supabase
    .from("topics")
    .update({ status: "RESEARCHING" })
    .eq("id", topicId)
    .eq("status", "RESEARCH_READY");

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: "RESEARCH_READY",
    to_status: "RESEARCHING",
    approved_by: user.id,
    note: note || null,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_changes_requested",
    actor_id: user.id,
    detail: note ? { note } : null,
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}
