import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { EmployeeId } from "./boss-language";

/**
 * Data access for ADMIN's per-employee prompt addenda — the versioned
 * "补充说明" layer of the Skill system (see src/lib/ai/skills.ts for the
 * fixed GLOBAL_SKILL/EMPLOYEE_DEFAULT_SKILL layers, which are code-level
 * and NOT stored here). `employee_instructions` is insert-only as of
 * migration 0013 (never overwrites, mirrors content_assets/content_images
 * versioning) — "current" = the highest `version` per employee_id.
 */

export interface EmployeeInstructionVersion {
  id: string;
  employee_id: EmployeeId;
  version: number;
  custom_instructions: string;
  change_note: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** Every employee's CURRENT (highest-version) addendum — used by the handbook overview. */
export async function getEmployeeInstructions(): Promise<Partial<Record<EmployeeId, string>>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_instructions")
    .select("employee_id, version, custom_instructions")
    .order("version", { ascending: false });
  if (error || !data) return {};

  const instructions: Partial<Record<EmployeeId, string>> = {};
  for (const row of data) {
    // Rows arrive newest-version-first per employee — keep only the first (current) one seen.
    const employeeId = row.employee_id as EmployeeId;
    if (!(employeeId in instructions)) {
      instructions[employeeId] = row.custom_instructions as string;
    }
  }
  return instructions;
}

/** One employee's CURRENT addendum text — used by the AI dispatch call sites, which only ever need a single employee's text. */
export async function getEmployeeInstruction(employeeId: EmployeeId): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_instructions")
    .select("custom_instructions")
    .eq("employee_id", employeeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.custom_instructions;
}

/** Full version history for one employee, newest first — used by the handbook's "历史版本" panel. */
export async function getEmployeeInstructionVersions(employeeId: EmployeeId): Promise<EmployeeInstructionVersion[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_instructions")
    .select("*")
    .eq("employee_id", employeeId)
    .order("version", { ascending: false });
  if (error || !data) return [];
  return data as EmployeeInstructionVersion[];
}
