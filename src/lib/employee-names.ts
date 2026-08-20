import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { EmployeeId } from "./boss-language";

/**
 * Data access for ADMIN's custom digital-employee names
 * (employee_names table — see supabase/migrations/0008_digital_employee_expansion.sql).
 * Demo mode (no Supabase configured) has no custom names, so every page
 * falls back to the defaults in boss-language.ts.
 */
export async function getEmployeeNames(): Promise<Partial<Record<EmployeeId, string>>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_names").select("employee_id, custom_name");
  if (error || !data) return {};

  const names: Partial<Record<EmployeeId, string>> = {};
  for (const row of data) {
    names[row.employee_id as EmployeeId] = row.custom_name as string;
  }
  return names;
}
