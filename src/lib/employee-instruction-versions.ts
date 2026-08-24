/**
 * Pure version-bookkeeping for employee_instructions — no Supabase, so
 * it's directly unit-testable. Mirrors content-versions.ts's
 * nextVersionNumber: an edit or a restore always inserts a new row with
 * version = previous max + 1, never overwrites. See
 * supabase/migrations/0013_skill_versioning_and_brand_config.sql.
 */
export function nextInstructionVersion(existingVersions: number[]): number {
  if (existingVersions.length === 0) return 1;
  return Math.max(...existingVersions) + 1;
}
