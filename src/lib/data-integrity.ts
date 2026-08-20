import { isAtOrPastStage } from "./topic-workflow";
import type { Topic } from "./types";

/**
 * Pure integrity check — no Supabase, no "server-only" import, fully
 * unit-testable. Flags topics whose pipeline status implies AI-generated
 * data that doesn't actually exist (e.g. seeded directly at an advanced
 * status for the pipeline stage-view pages, without a real Research
 * Agent/Content Agent run behind it — see docs/search-router.md
 * "Seed-data integrity" for the real instance of this found in this
 * database). Deliberately a lightweight admin-visible check, not a
 * database constraint — a constraint here would block legitimate manual
 * status corrections.
 */

export type IntegrityIssueType = "missing_research_pack" | "missing_content_asset";

export interface IntegrityIssue {
  topicId: string;
  code: string;
  title: string;
  status: Topic["status"];
  issue: IntegrityIssueType;
}

export function findResearchIntegrityIssues(
  topics: readonly Pick<Topic, "id" | "code" | "title" | "status">[],
  topicIdsWithResearchPack: ReadonlySet<string>,
  topicIdsWithContentAsset: ReadonlySet<string>,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (const topic of topics) {
    if (isAtOrPastStage(topic.status, "RESEARCH_READY") && !topicIdsWithResearchPack.has(topic.id)) {
      issues.push({ topicId: topic.id, code: topic.code, title: topic.title, status: topic.status, issue: "missing_research_pack" });
    }
    if (isAtOrPastStage(topic.status, "CONTENT_DRAFT") && !topicIdsWithContentAsset.has(topic.id)) {
      issues.push({ topicId: topic.id, code: topic.code, title: topic.title, status: topic.status, issue: "missing_content_asset" });
    }
  }

  return issues;
}
