"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { computeTopicScore } from "@/lib/scoring";
import { runTopicDiscoveryTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import type { TopicCandidate } from "@/lib/ai/topic-discovery";
import type { TopicInput } from "@/lib/types";

export interface DiscoverTopicsResult {
  candidates: TopicCandidate[];
  error: string | null;
}

/**
 * Employee A actively searches today's real UK immigration news and
 * proposes candidate topics — nothing is written to the topics table
 * here. See src/lib/ai/topic-discovery.ts and addDiscoveredTopic below.
 */
export async function discoverTopics(): Promise<DiscoverTopicsResult> {
  await requireUser();

  const result = await runTopicDiscoveryTask();
  const supabase = await createClient();

  if (isRouterResolutionFailure(result)) {
    return { candidates: [], error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  await writeUsageLog(supabase, {
    workflow_type: "topic_discovery",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: null,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "TOPIC_DISCOVERY",
    digital_employee: TASK_TYPE_EMPLOYEE.TOPIC_DISCOVERY,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    return { candidates: [], error: result.error ?? "选题搜索失败。" };
  }

  return { candidates: result.data.candidates, error: null };
}

/**
 * Adds one reviewed candidate to the topic library — goes through the
 * exact same insert shape as manual topic creation (src/app/topics/actions.ts
 * createTopic), just without the redirect, so the planner page can add
 * several candidates in a row without losing the rest of the list.
 */
export async function addDiscoveredTopic(candidate: TopicCandidate): Promise<{ ok: boolean }> {
  const user = await requireUser();

  const input: TopicInput = {
    title: candidate.title,
    question: candidate.question,
    business: candidate.business,
    audience: candidate.audience,
    content_pillar: candidate.content_pillar,
    priority: candidate.priority,
  };
  const { total, breakdown } = computeTopicScore(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topics")
    .insert({
      ...input,
      status: "IDEA",
      created_by: user.id,
      topic_score: total,
      score_breakdown: breakdown,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false };

  await supabase.from("topic_activity_log").insert({
    topic_id: data.id,
    activity_type: "topic_created",
    actor_id: user.id,
  });

  revalidatePath("/topics");
  revalidatePath("/team/planner");
  return { ok: true };
}
