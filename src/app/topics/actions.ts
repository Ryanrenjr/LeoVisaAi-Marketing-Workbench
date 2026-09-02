"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getTopicById } from "@/lib/topics";
import { computeTopicScore } from "@/lib/scoring";
import { validateTopicInput } from "@/lib/topic-validation";
import { canApproveResearch, canArchiveTopic } from "@/lib/permissions";
import { canArchive, canStartResearch } from "@/lib/topic-workflow";
import type { ContentPillar, TopicInput, TopicPriority, TopicStatus } from "@/lib/types";

export interface TopicFormState {
  error: string | null;
}

function readTopicInput(formData: FormData): TopicInput {
  const contentPillar = String(formData.get("content_pillar") ?? "");
  return {
    title: String(formData.get("title") ?? "").trim(),
    question: String(formData.get("question") ?? "").trim(),
    business: String(formData.get("business") ?? "").trim(),
    audience: String(formData.get("audience") ?? "").trim(),
    content_pillar: contentPillar ? (contentPillar as ContentPillar) : null,
    priority: (String(formData.get("priority") ?? "MEDIUM") as TopicPriority) || "MEDIUM",
  };
}

export async function createTopic(
  _prevState: TopicFormState,
  formData: FormData,
): Promise<TopicFormState> {
  const user = await requireUser();
  const input = readTopicInput(formData);

  const { valid, errors } = validateTopicInput(input);
  if (!valid) return { error: errors.join(" ") };

  const { total, breakdown } = computeTopicScore(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topics")
    .insert({
      title: input.title,
      question: input.question,
      business: input.business,
      audience: input.audience,
      content_pillar: input.content_pillar,
      priority: input.priority,
      status: "IDEA",
      created_by: user.id,
      topic_score: total,
      score_breakdown: breakdown,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "创建失败，请重试。" };

  await supabase.from("topic_activity_log").insert({
    topic_id: data.id,
    activity_type: "topic_created",
    actor_id: user.id,
  });

  revalidatePath("/topics");
  redirect(`/topics/${data.id}`);
}

export async function updateTopic(
  topicId: string,
  _prevState: TopicFormState,
  formData: FormData,
): Promise<TopicFormState> {
  const user = await requireUser();
  const current = await getTopicById(topicId);
  if (!current) return { error: "未找到该选题。" };

  const input = readTopicInput(formData);
  const { valid, errors } = validateTopicInput(input);
  if (!valid) return { error: errors.join(" ") };

  const scoreRaw = formData.get("topic_score");
  const nextScore = scoreRaw !== null ? Number(scoreRaw) : current.topic_score;
  const scoreChanged = Number.isFinite(nextScore) && nextScore !== current.topic_score;

  const fieldsChanged =
    input.title !== current.title ||
    input.question !== current.question ||
    input.business !== current.business ||
    input.audience !== current.audience ||
    input.content_pillar !== current.content_pillar ||
    input.priority !== current.priority;

  const supabase = await createClient();
  const update: Record<string, unknown> = {
    title: input.title,
    question: input.question,
    business: input.business,
    audience: input.audience,
    content_pillar: input.content_pillar,
    priority: input.priority,
  };
  if (scoreChanged) update.topic_score = nextScore;

  const { error } = await supabase.from("topics").update(update).eq("id", topicId);
  if (error) return { error: "保存失败，请重试。" };

  if (fieldsChanged) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "topic_edited",
      actor_id: user.id,
    });
  }
  if (scoreChanged) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "score_manually_changed",
      actor_id: user.id,
      detail: { from: current.topic_score, to: nextScore },
    });
  }

  revalidatePath("/topics");
  revalidatePath(`/topics/${topicId}`);
  redirect(`/topics/${topicId}`);
}

export async function rescoreTopic(topicId: string) {
  const user = await requireUser();
  const topic = await getTopicById(topicId);
  if (!topic) return;

  const { total, breakdown } = computeTopicScore(topic);

  const supabase = await createClient();
  await supabase
    .from("topics")
    .update({ topic_score: total, score_breakdown: breakdown })
    .eq("id", topicId);

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "topic_scored",
    actor_id: user.id,
    detail: { total, breakdown },
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}

export async function startResearch(topicId: string, currentStatus: TopicStatus) {
  const user = await requireUser();
  if (!canStartResearch(currentStatus)) return;

  const supabase = await createClient();
  await supabase
    .from("topics")
    .update({ status: "RESEARCHING" })
    .eq("id", topicId)
    .eq("status", currentStatus);

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: currentStatus,
    to_status: "RESEARCHING",
    approved_by: user.id,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "research_requested",
    actor_id: user.id,
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}

/**
 * The "淘汰" / "一次性工具" primitive (live user instruction, 2026-09):
 * this topic and everything derived from it is gone, permanently — not a
 * status change, not a soft-hide. `topics` cascades (`on delete cascade`)
 * through research/content/compliance/activity/status-event rows, so a
 * single delete here clears the whole tree; the one thing that does NOT
 * cascade is the actual bytes in Supabase Storage, so generated images
 * are removed explicitly first. Called both when a session is rejected
 * partway through, and — bound to the final download — when a session
 * completes. See CLAUDE.md rule 4.
 */
export async function discardTopic(topicId: string) {
  const user = await requireUser();
  if (!canApproveResearch(user.role)) throw new Error("Forbidden: ADMIN or EXPERT role required");

  const supabase = await createClient();

  const { data: images } = await supabase.from("content_images").select("image_path").eq("topic_id", topicId);
  const paths = (images ?? []).map((img) => img.image_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    await supabase.storage.from("content-images").remove(paths);
  }

  await supabase.from("topics").delete().eq("id", topicId);

  revalidatePath("/topics");
  redirect("/");
}

export async function archiveTopic(topicId: string, currentStatus: TopicStatus) {
  const user = await requireUser();
  if (!canArchiveTopic(user.role)) throw new Error("Forbidden: ADMIN role required");
  if (!canArchive(currentStatus)) return;

  const supabase = await createClient();
  await supabase
    .from("topics")
    .update({ status: "ARCHIVED" })
    .eq("id", topicId)
    .eq("status", currentStatus);

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: currentStatus,
    to_status: "ARCHIVED",
    approved_by: user.id,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "topic_archived",
    actor_id: user.id,
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
}
