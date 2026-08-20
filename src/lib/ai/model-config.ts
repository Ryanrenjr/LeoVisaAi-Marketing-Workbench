import "server-only";
import { createClient } from "../supabase/server";
import { isSupabaseConfigured } from "../supabase/config";
import type { AIProviderId, ModelRef, TaskType } from "./providers/types";

/**
 * Data access for ADMIN's persisted per-task model defaults
 * (model_routing_config table — see supabase/migrations/0006_model_router.sql).
 * Demo mode (no Supabase configured) has no persisted config, so the
 * Router falls through to its Development Mode free-first logic.
 */

export async function getModelRoutingConfig(): Promise<Partial<Record<TaskType, ModelRef>>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.from("model_routing_config").select("task_type, provider, model_id");
  if (error || !data) return {};

  const config: Partial<Record<TaskType, ModelRef>> = {};
  for (const row of data) {
    config[row.task_type as TaskType] = {
      provider: row.provider as AIProviderId,
      modelId: row.model_id as string,
    };
  }
  return config;
}
