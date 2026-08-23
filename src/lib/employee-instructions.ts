import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { EmployeeId } from "./boss-language";

/**
 * Data access for ADMIN's per-employee prompt addenda
 * (employee_instructions table — see
 * supabase/migrations/0012_employee_instructions.sql). Demo mode (no
 * Supabase configured) has no custom instructions, so every AI call falls
 * back to the code-only default prompt.
 */
export async function getEmployeeInstructions(): Promise<Partial<Record<EmployeeId, string>>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_instructions").select("employee_id, custom_instructions");
  if (error || !data) return {};

  const instructions: Partial<Record<EmployeeId, string>> = {};
  for (const row of data) {
    instructions[row.employee_id as EmployeeId] = row.custom_instructions as string;
  }
  return instructions;
}

/** One employee's addendum — used by the AI dispatch call sites, which only ever need a single employee's text. */
export async function getEmployeeInstruction(employeeId: EmployeeId): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_instructions")
    .select("custom_instructions")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error || !data) return null;
  return data.custom_instructions;
}
