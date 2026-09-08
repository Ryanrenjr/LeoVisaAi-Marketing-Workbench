"use server";

import { timingSafeEqual } from "crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface LoginState {
  error: string | null;
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;

/** Constant-time string compare — avoids a timing side-channel on the shared password check. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Best-effort caller IP for rate limiting — Vercel sets x-forwarded-for; falls back to a shared "unknown" bucket for local dev (never the actual threat model). */
async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
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

  // Rate limit — a public URL with a single shared password can otherwise
  // be brute-forced with unlimited attempts. Tracked per-IP in Postgres
  // (only ever touched via the service-role client below, never exposed
  // to any client) rather than in-memory, since serverless function
  // instances don't share memory across invocations.
  const admin = createAdminClient();
  const ip = await getClientIp();

  const { data: attempt } = await admin
    .from("login_attempts")
    .select("fail_count, locked_until")
    .eq("ip", ip)
    .maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60_000);
    return { error: `尝试次数过多，请 ${minutesLeft} 分钟后再试。` };
  }

  const password = String(formData.get("password") ?? "");
  if (!safeEqual(password, sitePassword)) {
    const failCount = (attempt?.fail_count ?? 0) + 1;
    const lockedUntil = failCount >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await admin
      .from("login_attempts")
      .upsert({ ip, fail_count: failCount, locked_until: lockedUntil, updated_at: new Date().toISOString() });
    return { error: "密码不正确。" };
  }

  // Correct password — clear this IP's attempt history.
  await admin.from("login_attempts").delete().eq("ip", ip);

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
