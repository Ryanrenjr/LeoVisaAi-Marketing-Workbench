"use server";

import { timingSafeEqual } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface LoginState {
  error: string | null;
}

/** Constant-time string compare — avoids a timing side-channel on the shared password check. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Single shared-password gate — live user instruction: "不要分用户登录
 *了，彻底变成一个一次性工具" (no more per-person accounts). There is still
 * exactly one real Supabase Auth account underneath (OPERATOR_EMAIL, the
 * existing ADMIN profile) — every table's RLS policies and foreign keys
 * (created_by/approved_by/decided_by/... all reference public.profiles)
 * still need a real signed-in user, and rewriting that layer for zero
 * behavioral gain wasn't worth the risk. So: whoever knows SITE_PASSWORD
 * gets signed in AS that one fixed account, transparently, without ever
 * needing (or this code ever storing) that account's real password —
 * generateLink mints a one-time token for OPERATOR_EMAIL server-side via
 * the service-role Admin API, verifyOtp immediately redeems it on the
 * cookie-bound client to establish a normal session. Everything downstream
 * (getCurrentUser, permissions.ts, proxy.ts route protection) is unchanged
 * and keeps working exactly as before, just always resolving to the same
 * person.
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase 尚未配置，当前为演示模式（无需登录）。" };
  }

  const sitePassword = process.env.SITE_PASSWORD;
  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!sitePassword || !operatorEmail) {
    return { error: "尚未配置访问密码（SITE_PASSWORD / OPERATOR_EMAIL），请联系管理员。" };
  }

  const password = String(formData.get("password") ?? "");
  if (!safeEqual(password, sitePassword)) {
    return { error: "密码不正确。" };
  }

  const admin = createAdminClient();
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: operatorEmail,
  });
  if (linkError || !data?.properties?.hashed_token) {
    return { error: "登录失败，请重试。" };
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  });
  if (verifyError) {
    return { error: "登录失败，请重试。" };
  }

  redirect("/");
}

export async function logout() {
  if (!isSupabaseConfigured()) {
    redirect("/");
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
