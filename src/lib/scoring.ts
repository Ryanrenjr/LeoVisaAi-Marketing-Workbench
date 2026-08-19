import type { ScoreBreakdown, TopicInput, TopicPriority } from "./types";

/**
 * Deterministic, rule-based topic score — NOT AI. This is what "重新评分"
 * recomputes. Research AI / automatic scoring is explicitly out of scope
 * for this milestone; see CLAUDE.md.
 *
 * - priority contributes up to 60 points (HIGH 60 / MEDIUM 35 / LOW 15)
 * - completeness contributes up to 40 points (10 each for business,
 *   audience, content_pillar, question being filled in) — a proxy for
 *   how ready the topic is to move into research.
 */
const PRIORITY_WEIGHT: Record<TopicPriority, number> = {
  HIGH: 60,
  MEDIUM: 35,
  LOW: 15,
};

const COMPLETENESS_FIELD_WEIGHT = 10;

function isFilled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function computeTopicScore(input: TopicInput): {
  total: number;
  breakdown: ScoreBreakdown;
} {
  const priority = PRIORITY_WEIGHT[input.priority];

  const completeness =
    (isFilled(input.business) ? COMPLETENESS_FIELD_WEIGHT : 0) +
    (isFilled(input.audience) ? COMPLETENESS_FIELD_WEIGHT : 0) +
    (input.content_pillar ? COMPLETENESS_FIELD_WEIGHT : 0) +
    (isFilled(input.question) ? COMPLETENESS_FIELD_WEIGHT : 0);

  return {
    total: priority + completeness,
    breakdown: { priority, completeness },
  };
}
