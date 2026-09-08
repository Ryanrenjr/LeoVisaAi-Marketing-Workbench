import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { CurrentUser } from "./types";

/**
 * The signed-in staff member, or null if unauthenticated / Supabase isn't
 * configured yet (demo mode — see docs/architecture.md).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // Same defense as src/proxy.ts's middleware check, applied here too so
  // every direct requireUser() call in a Server Action is covered even if
  // a route somehow isn't matched by the middleware — a session that
  // isn't the one fixed operator account is not a logged-in user as far
  // as this app is concerned, regardless of how it was obtained.
  if (profile.email !== process.env.OPERATOR_EMAIL) return null;

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}
