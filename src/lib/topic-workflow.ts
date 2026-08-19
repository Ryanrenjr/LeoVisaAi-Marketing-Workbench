import type { TopicStatus } from "./types";

/**
 * Ordered, linear pipeline stages — the full intended Phase 1 shape.
 * ARCHIVED is a side state, not part of the linear order.
 *
 * Only IDEA→RESEARCHING, RESEARCHING⇄RESEARCH_READY, RESEARCH_READY→
 * RESEARCH_APPROVED, and *→ARCHIVED are wired to real actions as of this
 * milestone. CONTENT_DRAFT/COMPLIANCE_REVIEW/LEO_REVIEW/APPROVED exist
 * here so the model is complete and nextStatus()/isAllowedTransition() are
 * correct end-to-end, but nothing transitions into them yet — Content AI
 * is a future milestone. See docs/phase-3-5-plan.md.
 */
const PIPELINE_ORDER: readonly TopicStatus[] = [
  "IDEA",
  "RESEARCHING",
  "RESEARCH_READY",
  "RESEARCH_APPROVED",
  "CONTENT_DRAFT",
  "COMPLIANCE_REVIEW",
  "LEO_REVIEW",
  "APPROVED",
  "READY_TO_SHOOT",
  "PUBLISHED",
];

/** The next status in the linear pipeline, or null if already at the end (or archived). */
export function nextStatus(status: TopicStatus): TopicStatus | null {
  const index = PIPELINE_ORDER.indexOf(status);
  if (index === -1 || index === PIPELINE_ORDER.length - 1) return null;
  return PIPELINE_ORDER[index + 1];
}

/**
 * Whether moving a topic from `from` to `to` is an allowed workflow
 * transition: either the single next linear stage, or archiving from any
 * non-archived stage. Skipping stages, moving backwards, and any
 * transition out of ARCHIVED are all disallowed.
 */
export function isAllowedTransition(from: TopicStatus, to: TopicStatus): boolean {
  if (from === "ARCHIVED") return false;
  if (to === "ARCHIVED") return true;
  return nextStatus(from) === to;
}

export function canStartResearch(status: TopicStatus): boolean {
  return isAllowedTransition(status, "RESEARCHING");
}

export function canArchive(status: TopicStatus): boolean {
  return isAllowedTransition(status, "ARCHIVED");
}

/**
 * Whether `status` is at or past `milestone` in the linear pipeline.
 * ARCHIVED is never "at or past" anything — an archived topic isn't
 * actively anywhere in the forward pipeline. Used for gates like
 * "content generation requires research to be approved" that should
 * stay true for every stage from that point on, not just one exact value.
 */
export function isAtOrPastStage(status: TopicStatus, milestone: TopicStatus): boolean {
  if (status === "ARCHIVED") return false;
  const statusIndex = PIPELINE_ORDER.indexOf(status);
  const milestoneIndex = PIPELINE_ORDER.indexOf(milestone);
  return statusIndex !== -1 && milestoneIndex !== -1 && statusIndex >= milestoneIndex;
}
