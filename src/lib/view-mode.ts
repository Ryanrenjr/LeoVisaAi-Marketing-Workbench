import type { UserRole } from "./types";

/**
 * Boss Mode vs Admin Mode is a presentation-layer distinction only — see
 * docs/digital-employee-ux.md. It never changes what a user is allowed to
 * do; existing server-side role checks (canRunResearch, canApproveResearch,
 * canManageContentAssets, etc.) remain the only source of truth for that.
 */
export type ViewMode = "boss" | "admin";

export const VIEW_MODE_COOKIE = "view_mode";

/**
 * EXPERT always sees Boss Mode — there is no EXPERT preview of Admin Mode.
 * ADMIN defaults to Admin Mode but can opt into a Boss Mode preview via
 * the cookie. A stray/tampered cookie can never grant an EXPERT admin
 * framing, since that branch never reads the cookie at all.
 */
export function resolveViewMode(role: UserRole, cookieValue: string | undefined): ViewMode {
  if (role === "EXPERT") return "boss";
  return cookieValue === "boss" ? "boss" : "admin";
}
