import { isAtOrPastStage } from "./topic-workflow";
import type { TopicStatus, UserRole } from "./types";

/**
 * Archiving removes a topic from active consideration — treated as the
 * one ADMIN-only action in the topic library, everything else (create,
 * edit, rescore, start research) is open to any signed-in EXPERT/ADMIN.
 */
export function canArchiveTopic(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Running/editing/re-running research is ADMIN-only.
 */
export function canRunResearch(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Approving research was originally EXPERT-only — a two-person integrity
 * control so the ADMIN who ran the research couldn't approve their own
 * run. Live user instruction: this app has a single ADMIN operator in
 * practice, so ADMIN gains approval rights too, ADDITIVELY — EXPERT keeps
 * it unchanged for whenever a second reviewer exists.
 */
export function canApproveResearch(role: UserRole): boolean {
  return role === "ADMIN" || role === "EXPERT";
}

/**
 * The mandatory content-generation gate: research must be approved first,
 * and every stage after that (CONTENT_DRAFT, COMPLIANCE_REVIEW,
 * LEO_REVIEW, APPROVED, ...) is also "past" that gate — this covers both
 * the very first generation and later regeneration of a single platform,
 * which necessarily happens after the topic has already moved to
 * CONTENT_DRAFT. See docs/phase-4-plan.md "Content generation gate".
 */
export function canGenerateContent(status: TopicStatus): boolean {
  return isAtOrPastStage(status, "RESEARCH_APPROVED");
}

/**
 * ADMIN can generate/regenerate/edit content drafts. EXPERT can only view
 * them this milestone — final Expert content approval is a later
 * milestone, not built yet. See CLAUDE.md "Do not implement final Expert
 * Content Approval yet."
 */
export function canManageContentAssets(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Running Compliance (Employee D) is ADMIN-only, same posture as
 * generating content in the first place — it re-checks an already
 * generated draft, never a separate approval a different role must give.
 */
export function canRunCompliance(role: UserRole): boolean {
  return role === "ADMIN";
}
