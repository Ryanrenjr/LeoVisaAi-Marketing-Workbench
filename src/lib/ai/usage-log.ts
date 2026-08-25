import "server-only";
import type { createClient } from "../supabase/server";
import type { ContentPlatform } from "../types";
import type { AIProviderId, PricingType, TaskType } from "./providers/types";
import type { EmployeeId } from "../boss-language";
import type { SearchProviderId } from "../search/types";

/**
 * Reliable ai_usage_log writes: the insert's error is checked (previously
 * fire-and-forget), logged server-side, and reported back to the caller
 * so it can surface a restrained ADMIN-facing notice — without ever
 * destroying the Research/Content output that already succeeded. See
 * docs/provider-smoke-test.md "AI usage log reliability".
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface UsageLogInput {
  workflow_type:
    | "research"
    | "content"
    | "content_revision"
    | "compliance"
    | "topic_discovery"
    | "performance_analysis"
    | "image_generation";
  model_alias: string;
  /** Null for tasks not tied to one topic yet — e.g. topic discovery, which proposes candidates before any topic row exists. */
  topic_id: string | null;
  platform?: ContentPlatform;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  success: boolean;
  error: string | null;
  provider: AIProviderId;
  task_type: TaskType;
  digital_employee: EmployeeId;
  pricing_type_at_execution: PricingType | null;
}

export async function writeUsageLog(
  supabase: SupabaseServerClient,
  input: UsageLogInput,
): Promise<{ usageLogFailed: boolean }> {
  const { error } = await supabase.from("ai_usage_log").insert(input);
  if (error) {
    console.error("[ai_usage_log] insert failed:", error.message);
    return { usageLogFailed: true };
  }
  return { usageLogFailed: false };
}

/**
 * A separate small table rather than extending ai_usage_log: a search
 * call has no model/tokens/pricing-per-model-call semantics (its "cost"
 * unit is queries, not tokens), so folding it into ai_usage_log's columns
 * would mean a pile of always-null fields on one side or the other. Kept
 * deliberately minimal — see docs/search-router.md "Search usage logging".
 */
export interface SearchUsageLogInput {
  provider: SearchProviderId;
  digital_employee: EmployeeId;
  /** "IMAGE_SEARCH" isn't a Model Router TaskType — it never calls an AI model, only the Search Router. */
  task_type: TaskType | "IMAGE_SEARCH";
  topic_id: string;
  query_count: number;
  result_count: number;
  latency_ms: number;
  success: boolean;
  error: string | null;
}

export async function writeSearchUsageLog(
  supabase: SupabaseServerClient,
  input: SearchUsageLogInput,
): Promise<{ usageLogFailed: boolean }> {
  const { error } = await supabase.from("search_usage_log").insert(input);
  if (error) {
    console.error("[search_usage_log] insert failed:", error.message);
    return { usageLogFailed: true };
  }
  return { usageLogFailed: false };
}
