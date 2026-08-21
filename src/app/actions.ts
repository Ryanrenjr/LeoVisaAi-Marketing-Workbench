"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { nextStatus } from "@/lib/topic-workflow";
import type { TopicStatus } from "@/lib/types";

/**
 * The mandatory human-approval-gate action: advances one topic to the next
 * pipeline stage and records who approved it. See
 * docs/security-boundaries.md "Human approval gates".
 */
export async function advanceTopicStatus(topicId: string, fromStatus: TopicStatus) {
  const user = await requireUser();
  const toStatus = nextStatus(fromStatus);
  if (!toStatus) return;

  const supabase = await createClient();

  const update: { status: TopicStatus; published_at?: string } = { status: toStatus };
  if (toStatus === "PUBLISHED") update.published_at = new Date().toISOString();

  await supabase.from("topics").update(update).eq("id", topicId).eq("status", fromStatus);

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: fromStatus,
    to_status: toStatus,
    approved_by: user.id,
  });

  revalidatePath("/");
  revalidatePath("/research-completed");
  revalidatePath("/ready-to-shoot");
  revalidatePath("/published");
  revalidatePath(`/topics/${topicId}`);
}
