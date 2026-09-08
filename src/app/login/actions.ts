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
  //
  // Atomic (live audit finding): this used to be "SELECT fail_count -> JS
  // +1 -> UPSERT" — a lost-update race where concurrent wrong-password
  // requests for the same IP could read the same count and each write
  // back count+1, losing attempts instead of accumulating them — and none
  // of the three calls checked their own error, so a transient DB failure
  // silently looked like "no failure record" and let the attempt through
  // uncounted. record_login_attempt() (0031_login_rate_limit_rpc.sql) does
  // the whole "check lock, then record this attempt" sequence as one
  // atomic DB call; see its own comment for why. A failure calling it
  // fails CLOSED — this function returns an error rather than falling
  // through to generateLink/verifyOtp, even if the password was correct.
  const admin = createAdminClient();
  const ip = await getClientIp();
  const password = String(formData.get("password") ?? "");
  const passwordCorrect = safeEqual(password, sitePassword);

  const { data: attemptRows, error: attemptError } = await admin.rpc("record_login_attempt", {
    p_ip: ip,
    p_success: passwordCorrect,
    p_max_attempts: MAX_LOGIN_ATTEMPTS,
    p_lockout_seconds: LOCKOUT_MS / 1000,
  });
  if (attemptError || !attemptRows || attemptRows.length === 0) {
    return { error: "服务暂时不可用，请稍后重试。" };
  }
  const attempt = attemptRows[0] as { locked: boolean; locked_until: string | null; fail_count: number };

  if (attempt.locked) {
    const minutesLeft = attempt.locked_until
      ? Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60_000)
      : Math.ceil(LOCKOUT_MS / 60_000);
    return { error: `尝试次数过多，请 ${minutesLeft} 分钟后再试。` };
  }
  if (!passwordCorrect) {
    return { error: "密码不正确。" };
  }

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
