import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";
import { resolveViewMode, VIEW_MODE_COOKIE, type ViewMode } from "./view-mode";

/** Shared by layout.tsx (Nav) and any page that needs to branch on Boss vs Admin Mode. */
export async function getCurrentViewMode(): Promise<ViewMode> {
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()]);
  return resolveViewMode(user?.role ?? "EXPERT", cookieStore.get(VIEW_MODE_COOKIE)?.value);
}
