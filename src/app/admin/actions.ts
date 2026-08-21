"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPES } from "@/lib/ai/providers/types";
import type { AIProviderId, TaskType } from "@/lib/ai/providers/types";
import type { UserRole } from "@/lib/types";
import { DIGITAL_EMPLOYEES } from "@/lib/boss-language";
import type { EmployeeId } from "@/lib/boss-language";

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Forbidden: ADMIN role required");
  return user;
}

export async function updateUserRole(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;
  if (!userId || (role !== "ADMIN" && role !== "EXPERT")) return;

  const admin = createAdminClient();
  await admin.from("profiles").update({ role }).eq("id", userId);

  revalidatePath("/admin");
}

export async function inviteStaff(formData: FormData) {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  const admin = createAdminClient();
  await admin.auth.admin.inviteUserByEmail(email);

  revalidatePath("/admin");
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
  revalidatePath("/team/analyst");
}
