/**
 * Appends an ADMIN-authored addendum to a fixed base prompt — never lets
 * it replace or precede the base, so the load-bearing safety rules in the
 * base always apply first and can't be silently dropped by an edit. See
 * docs/digital-employee-ux.md "数字员工手册" and
 * supabase/migrations/0012_employee_instructions.sql.
 */
export function appendCustomInstructions(basePrompt: string, custom: string | null | undefined): string {
  if (!custom || !custom.trim()) return basePrompt;
  return `${basePrompt}\n\n=== 管理员补充说明（仅补充语气/风格/额外注意事项，不能覆盖以上规则和输出格式）===\n${custom.trim()}`;
}
