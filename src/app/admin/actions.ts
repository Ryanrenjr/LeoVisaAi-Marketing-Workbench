"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

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
