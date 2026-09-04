"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPES } from "@/lib/ai/providers/types";
import type { AIProviderId, TaskType } from "@/lib/ai/providers/types";
import { DIGITAL_EMPLOYEES } from "@/lib/boss-language";
import type { EmployeeId } from "@/lib/boss-language";
import { nextInstructionVersion } from "@/lib/employee-instruction-versions";

const BRAND_CONFIG_FIELDS = [
  ["companyNameEn", "company_name_en"],
  ["companyNameZh", "company_name_zh"],
  ["contentBrand", "content_brand"],
  ["expertName", "expert_name"],
  ["videoOutro", "video_outro"],
  ["wechatFooter", "wechat_footer"],
  ["expertCredentials", "expert_credentials"],
] as const;

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Forbidden: ADMIN role required");
  return user;
}

/**
 * ADMIN's persisted per-task default model — "AI 模型配置" in
 * /admin/ai-models. This is the "configured default" the Model Router
 * prefers over its Development Mode free-first search (see
 * src/lib/ai/model-selection.ts). An empty selection clears the override,
 * returning that task to the Router's automatic behaviour.
 */
export async function setTaskModelDefault(formData: FormData) {
  const user = await requireAdmin();

  const taskType = String(formData.get("taskType") ?? "") as TaskType;
  if (!TASK_TYPES.includes(taskType)) return;

  const admin = createAdminClient();

  const choice = String(formData.get("modelChoice") ?? "");
  if (!choice) {
    await admin.from("model_routing_config").delete().eq("task_type", taskType);
    revalidatePath("/admin/ai-models");
    return;
  }

  const [provider, modelId] = choice.split("::") as [AIProviderId, string];
  if (!getModel(provider, modelId)) return;

  await admin.from("model_routing_config").upsert({
    task_type: taskType,
    provider,
    model_id: modelId,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/admin/ai-models");
}

/**
 * ADMIN renames a digital employee — "员工可以起名字，方便理解" (live user
 * instruction). An empty submitted name resets to the default in
 * boss-language.ts rather than storing an empty string.
 */
export async function updateEmployeeName(formData: FormData) {
  const user = await requireAdmin();

  const employeeId = String(formData.get("employeeId") ?? "") as EmployeeId;
  if (!DIGITAL_EMPLOYEES.some((e) => e.id === employeeId)) return;

  const admin = createAdminClient();
  const customName = String(formData.get("customName") ?? "").trim();

  if (!customName) {
    await admin.from("employee_names").delete().eq("employee_id", employeeId);
  } else {
    await admin.from("employee_names").upsert({
      employee_id: employeeId,
      custom_name: customName,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/team/planner");
  revalidatePath("/team/researcher");
  revalidatePath("/team/video-editor");
  revalidatePath("/team/xiaohongshu-editor");
  revalidatePath("/team/image-designer");
  revalidatePath("/team/wechat-editor");
  revalidatePath("/team/compliance");
}

/**
 * ADMIN edits one digital employee's "手册" addendum — appended after the
 * fixed, code-only Skill (src/lib/ai/skills.ts GLOBAL_SKILL +
 * EMPLOYEE_DEFAULT_SKILL) every time that employee's AI call runs. Never
 * replaces those permanent rules — appendCustomInstructions always puts
 * this text strictly after them. `employee_instructions` is insert-only
 * (migration 0013): this never overwrites a row, it inserts the next
 * version, so every past addendum stays recoverable via
 * restoreEmployeeInstructionVersion below.
 */
export async function updateEmployeeInstructions(formData: FormData) {
  const user = await requireAdmin();

  const employeeId = String(formData.get("employeeId") ?? "") as EmployeeId;
  if (!DIGITAL_EMPLOYEES.some((e) => e.id === employeeId)) return;

  const admin = createAdminClient();
  const customInstructions = String(formData.get("customInstructions") ?? "").trim();
  const changeNote = String(formData.get("changeNote") ?? "").trim();

  const { data: existing } = await admin
    .from("employee_instructions")
    .select("version")
    .eq("employee_id", employeeId);
  const version = nextInstructionVersion((existing ?? []).map((row) => row.version as number));

  await admin.from("employee_instructions").insert({
    employee_id: employeeId,
    version,
    custom_instructions: customInstructions,
    change_note: changeNote || null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/team/handbook");
}

/**
 * ADMIN restores an older Skill addendum version — inserts a NEW version
 * whose text matches the chosen old one, auto-noted "恢复自 v{N}". Never
 * mutates or deletes the old row; history stays intact either way.
 */
export async function restoreEmployeeInstructionVersion(formData: FormData) {
  const user = await requireAdmin();

  const employeeId = String(formData.get("employeeId") ?? "") as EmployeeId;
  const restoreVersion = Number(formData.get("version") ?? "");
  if (!DIGITAL_EMPLOYEES.some((e) => e.id === employeeId) || !Number.isFinite(restoreVersion)) return;

  const admin = createAdminClient();

  const { data: allVersions } = await admin
    .from("employee_instructions")
    .select("version, custom_instructions")
    .eq("employee_id", employeeId);
  if (!allVersions) return;

  const target = allVersions.find((row) => row.version === restoreVersion);
  if (!target) return;

  const nextVersion = nextInstructionVersion(allVersions.map((row) => row.version as number));

  await admin.from("employee_instructions").insert({
    employee_id: employeeId,
    version: nextVersion,
    custom_instructions: target.custom_instructions,
    change_note: `恢复自 v${restoreVersion}`,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/team/handbook");
}

/**
 * ADMIN edits the company brand configuration (brand_config table — see
 * supabase/migrations/0013_skill_versioning_and_brand_config.sql). Not
 * versioned like employee_instructions — each field is a plain upsert, the
 * DB row is simply "the current value." src/lib/brand-config.ts falls back
 * to DEFAULT_BRAND_CONFIG for any field left blank.
 */
export async function updateBrandConfig(formData: FormData) {
  const user = await requireAdmin();

  const admin = createAdminClient();
  const rows = BRAND_CONFIG_FIELDS.map(([formKey, dbKey]) => ({
    key: dbKey,
    value: String(formData.get(formKey) ?? "").trim(),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.value.length > 0);

  if (rows.length > 0) {
    await admin.from("brand_config").upsert(rows);
  }

  revalidatePath("/team/handbook");
}
