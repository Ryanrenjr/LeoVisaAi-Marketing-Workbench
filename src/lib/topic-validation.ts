import type { ContentPillar, TopicInput, TopicPriority } from "./types";

const VALID_PRIORITIES: readonly TopicPriority[] = ["LOW", "MEDIUM", "HIGH"];
const VALID_PILLARS: readonly ContentPillar[] = [
  "policy_update",
  "myth_busting",
  "how_to",
  "case_study",
  "news",
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTopicInput(input: Partial<TopicInput>): ValidationResult {
  const errors: string[] = [];

  if (!input.title || !input.title.trim()) {
    errors.push("标题不能为空。");
  }

  if (!input.question || !input.question.trim()) {
    errors.push("选题问题不能为空。");
  }

  if (input.priority && !VALID_PRIORITIES.includes(input.priority)) {
    errors.push("优先级无效。");
  }

  if (input.content_pillar && !VALID_PILLARS.includes(input.content_pillar)) {
    errors.push("内容支柱无效。");
  }

  return { valid: errors.length === 0, errors };
}
