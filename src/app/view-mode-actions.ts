"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/view-mode";

/**
 * Presentation-only — see docs/digital-employee-ux.md. Deliberately no
 * role check here: resolveViewMode() already ignores this cookie
 * entirely for EXPERT, so there is nothing for this action to gate.
 */
export async function setViewMode(mode: ViewMode, redirectTo: string) {
  const cookieStore = await cookies();
  cookieStore.set(VIEW_MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  redirect(redirectTo);
}
