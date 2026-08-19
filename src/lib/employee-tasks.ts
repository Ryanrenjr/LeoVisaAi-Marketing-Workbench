import { groupContentAssetsByLineage } from "./content-versions";
import { canGenerateContent } from "./permissions";
import { getEmployee, BOSS_CONFIDENCE_LABEL } from "./boss-language";
import type { ContentAsset, ResearchConfidence, Topic } from "./types";
import type { EvidenceNote } from "./ai/content-schemas";

/**
 * Pure aggregation of existing Topic/ResearchPack/ContentAsset data into
 * the "digital employee" framing — no new tables, no new workflow state.
 * See docs/digital-employee-ux.md.
 */

export interface PlannerSummary {
  todayCandidates: number;
  highPriority: number;
}

/** `libraryTopics` = topics in IDEA/RESEARCHING/RESEARCH_READY (getLibraryTopics()). */
export function summarizePlannerTasks(libraryTopics: Topic[]): PlannerSummary {
  return {
    todayCandidates: libraryTopics.length,
    highPriority: libraryTopics.filter((t) => t.priority === "HIGH").length,
  };
}

export interface ResearcherSummary {
  inProgress: number;
  awaitingReview: number;
}

export function summarizeResearcherTasks(topics: Topic[]): ResearcherSummary {
  return {
    inProgress: topics.filter((t) => t.status === "RESEARCHING").length,
    awaitingReview: topics.filter((t) => t.status === "RESEARCH_READY").length,
  };
}

export interface EditorSummary {
  pendingGeneration: number;
  draftsComplete: number;
}

/**
 * `contentEligibleTopics` = topics at RESEARCH_APPROVED or later
 * (canGenerateContent). `contentAssetsByTopicId` need only contain
 * entries for topics that actually have at least one asset.
 */
export function summarizeEditorTasks(
  contentEligibleTopics: Topic[],
  contentAssetsByTopicId: Map<string, ContentAsset[]>,
): EditorSummary {
  let pendingGeneration = 0;
  let draftsComplete = 0;
  for (const topic of contentEligibleTopics) {
    const assets = contentAssetsByTopicId.get(topic.id);
    if (assets && assets.length > 0) draftsComplete++;
    else pendingGeneration++;
  }
  return { pendingGeneration, draftsComplete };
}

/** Topics eligible for the Editor's attention — a thin filter, not new business logic. */
export function filterContentEligibleTopics(topics: Topic[]): Topic[] {
  return topics.filter((t) => canGenerateContent(t.status));
}

function countExpertReviewNotes(asset: ContentAsset): number {
  const notes = asset.structured_content?.expert_review_notes;
  return Array.isArray(notes) ? (notes as EvidenceNote[]).length : 0;
}

export interface ReviewItem {
  topicId: string;
  topicTitle: string;
  employeeId: "researcher" | "editor";
  employeeName: string;
  description: string;
  warning: string | null;
  href: string;
}

/**
 * Leo's unified review queue — aggregates only what's already real and
 * already gated by real backend rules:
 * - RESEARCH_READY topics (a research pack exists and needs Leo's
 *   approve/changes-requested decision — the same gate research-actions.ts
 *   already enforces).
 * - Topics whose latest content draft(s) carry expert_review_notes (the
 *   Content Agent's own evidence-boundary flags — never a fabricated count).
 *
 * "Final Expert Content Approval" is not implemented yet (see CLAUDE.md),
 * so content items surface here as "needs a look," not as a formal
 * approval gate the way research items are.
 */
export function buildLeoReviewQueue(
  topics: Topic[],
  contentAssetsByTopicId: Map<string, ContentAsset[]>,
  confidenceByTopicId: Map<string, ResearchConfidence> = new Map(),
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const topic of topics) {
    if (topic.status !== "RESEARCH_READY") continue;
    const confidence = confidenceByTopicId.get(topic.id);
    items.push({
      topicId: topic.id,
      topicTitle: topic.title,
      employeeId: "researcher",
      employeeName: getEmployee("researcher").name,
      description: "研究已完成，请确认是否可以使用",
      warning: confidence === "LOW" ? BOSS_CONFIDENCE_LABEL.LOW : null,
      href: `/topics/${topic.id}?tab=research`,
    });
  }

  for (const topic of topics) {
    const assets = contentAssetsByTopicId.get(topic.id);
    if (!assets || assets.length === 0) continue;
    const lineages = groupContentAssetsByLineage(assets);
    const noteCount = lineages.reduce((sum, l) => sum + countExpertReviewNotes(l.latest), 0);
    if (noteCount === 0) continue;
    items.push({
      topicId: topic.id,
      topicTitle: topic.title,
      employeeId: "editor",
      employeeName: getEmployee("editor").name,
      description: `内容草稿有 ${noteCount} 项需要确认`,
      warning: null,
      href: `/topics/${topic.id}?tab=video`,
    });
  }

  return items;
}
