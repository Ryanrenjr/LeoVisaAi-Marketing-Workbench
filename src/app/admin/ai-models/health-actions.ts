"use server";

import { requireUser } from "@/lib/auth";
import { checkProviderHealth, checkModelHealth, type HealthCheckResult } from "@/lib/ai/provider-health";
import { checkSearchProviderHealth, type SearchHealthCheckResult } from "@/lib/search/search-health";
import { AI_PROVIDER_IDS } from "@/lib/ai/providers/types";
import type { AIProviderId } from "@/lib/ai/providers/types";
import type { SearchProviderId } from "@/lib/search/types";

const CHECKABLE: readonly AIProviderId[] = AI_PROVIDER_IDS;
const SEARCH_CHECKABLE: readonly SearchProviderId[] = ["TAVILY", "BRAVE"];

/** ADMIN-only development diagnostic — see docs/provider-smoke-test.md. Not exposed to Boss Mode or EXPERT. */
export async function runProviderHealthCheck(
  _prevState: HealthCheckResult | null,
  formData: FormData,
): Promise<HealthCheckResult | null> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return null;

  const provider = String(formData.get("provider") ?? "") as AIProviderId;
  if (!CHECKABLE.includes(provider)) return null;

  return checkProviderHealth(provider);
}

/**
 * Tests the EXACT model currently chosen in one task's dropdown — not a
 * stand-in. See src/app/admin/ai-models/page.tsx's per-task 测试 button.
 */
export async function runModelHealthCheck(
  _prevState: HealthCheckResult | null,
  formData: FormData,
): Promise<HealthCheckResult | null> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return null;

  const provider = String(formData.get("provider") ?? "") as AIProviderId;
  const modelId = String(formData.get("modelId") ?? "");
  if (!CHECKABLE.includes(provider) || !modelId) return null;

  return checkModelHealth(provider, modelId);
}

/** ADMIN-only development diagnostic for Search Providers — see docs/search-router.md. Not exposed to Boss Mode or EXPERT. */
export async function runSearchProviderHealthCheck(
  _prevState: SearchHealthCheckResult | null,
  formData: FormData,
): Promise<SearchHealthCheckResult | null> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return null;

  const provider = String(formData.get("provider") ?? "") as SearchProviderId;
  if (!SEARCH_CHECKABLE.includes(provider)) return null;

  return checkSearchProviderHealth(provider);
}
