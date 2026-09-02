import type { TopicStatus } from "./types";

/**
 * Pure status-gating rules for the research stage — separated from
 * research-actions.ts so they're testable without touching Supabase.
 * See docs/phase-3-5-plan.md "RESEARCH_READY placement".
 */

/** ADMIN can (re-)run research while a topic is being worked on or awaiting review. */
export function canRunResearchFromStatus(status: TopicStatus): boolean {
  return status === "RESEARCHING" || status === "RESEARCH_READY";
}

/** EXPERT can only approve/reject a pack once it's actually ready for review. */
export function canApproveResearchFromStatus(status: TopicStatus): boolean {
  return status === "RESEARCH_READY";
}
