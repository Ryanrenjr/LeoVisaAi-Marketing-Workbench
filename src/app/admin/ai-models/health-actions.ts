"use server";

import { requireUser } from "@/lib/auth";
import { checkProviderHealth, type HealthCheckResult } from "@/lib/ai/provider-health";
import { checkSearchProviderHealth, type SearchHealthCheckResult } from "@/lib/search/search-health";
import type { AIProviderId } from "@/lib/ai/providers/types";
import type { SearchProviderId } from "@/lib/search/types";

const CHECKABLE: readonly AIProviderId[] = ["GOOGLE", "GROQ"];
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
