import { groupContentAssetsByLineage } from "./content-versions";
import { canGenerateContent } from "./permissions";
import { BOSS_CONFIDENCE_LABEL, resolveEmployeeDisplayName } from "./boss-language";
import type { EmployeeId } from "./boss-language";
import type { ComplianceReviewRow, ContentAsset, ContentPlatform, ResearchConfidence, Topic } from "./types";
import type { EvidenceNote } from "./ai/content-schemas";

/** Which content-editor employee owns a review item generated from a given platform's draft. */
const PLATFORM_EMPLOYEE: Record<ContentPlatform, "video-editor" | "xiaohongshu-editor" | "wechat-editor"> = {
  VIDEO_CHANNEL: "video-editor",
  XIAOHONGSHU: "xiaohongshu-editor",
  WECHAT_OFFICIAL_ACCOUNT: "wechat-editor",
};

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
 * entries for topics that actually have at least one asset. `platform`
 * scopes the count to one platform-specific editor — since the "编辑"
 * employee split into video-editor/xiaohongshu-editor/wechat-editor, a
 * topic can be "drafts complete" for one platform while still pending for
 * another.
 */
export function summarizeEditorTasks(
  contentEligibleTopics: Topic[],
  contentAssetsByTopicId: Map<string, ContentAsset[]>,
  platform: ContentPlatform,
): EditorSummary {
  let pendingGeneration = 0;
  let draftsComplete = 0;
  for (const topic of contentEligibleTopics) {
    const assets = contentAssetsByTopicId.get(topic.id);
    if (assets?.some((a) => a.platform === platform)) draftsComplete++;
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
  employeeId: "researcher" | "video-editor" | "xiaohongshu-editor" | "wechat-editor";
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
  employeeNames: Partial<Record<EmployeeId, string>> = {},
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const topic of topics) {
    if (topic.status !== "RESEARCH_READY") continue;
    const confidence = confidenceByTopicId.get(topic.id);
    items.push({
      topicId: topic.id,
      topicTitle: topic.title,
      employeeId: "researcher",
      employeeName: resolveEmployeeDisplayName("researcher", employeeNames),
      description: "研究已完成，请确认是否可以使用",
      warning: confidence === "LOW" ? BOSS_CONFIDENCE_LABEL.LOW : null,
      href: `/topics/${topic.id}/research/review`,
    });
  }

  for (const topic of topics) {
    const assets = contentAssetsByTopicId.get(topic.id);
    if (!assets || assets.length === 0) continue;
    const lineages = groupContentAssetsByLineage(assets);

    // One item per platform that actually has notes — each platform is now
    // a separate employee, so a combined cross-platform count would
    // misattribute work to the wrong one.
    const notesByPlatform = new Map<ContentPlatform, number>();
    for (const lineage of lineages) {
      const count = countExpertReviewNotes(lineage.latest);
      if (count === 0) continue;
      notesByPlatform.set(lineage.platform, (notesByPlatform.get(lineage.platform) ?? 0) + count);
    }

    for (const [platform, noteCount] of notesByPlatform) {
      const employeeId = PLATFORM_EMPLOYEE[platform];
      items.push({
        topicId: topic.id,
        topicTitle: topic.title,
        employeeId,
        employeeName: resolveEmployeeDisplayName(employeeId, employeeNames),
        description: `内容草稿有 ${noteCount} 项需要确认`,
        warning: null,
        href: `/topics/${topic.id}?tab=video`,
      });
    }
  }

  return items;
}

export interface ComplianceQueueItem {
  topicId: string;
  topicTitle: string;
  contentAssetId: string;
  platformLabel: string;
  /** Null = never reviewed yet. */
  latestReview: ComplianceReviewRow | null;
}

/**
 * Every latest-version content asset, paired with its most recent
 * compliance review if one exists. "Needs attention" (never reviewed, or
 * last review was MEDIUM/HIGH) is a UI-level filter on this list, not a
 * separate query — see /team/compliance.
 */
export function buildComplianceQueue(
  topics: Topic[],
  contentAssetsByTopicId: Map<string, ContentAsset[]>,
  reviewsByContentAssetId: Map<string, ComplianceReviewRow>,
): ComplianceQueueItem[] {
  const items: ComplianceQueueItem[] = [];
  const topicById = new Map(topics.map((t) => [t.id, t]));

  for (const [topicId, assets] of contentAssetsByTopicId) {
    const topic = topicById.get(topicId);
    if (!topic) continue;
    const lineages = groupContentAssetsByLineage(assets);
    for (const lineage of lineages) {
      items.push({
        topicId,
        topicTitle: topic.title,
        contentAssetId: lineage.latest.id,
        platformLabel: lineage.latest.platform,
        latestReview: reviewsByContentAssetId.get(lineage.latest.id) ?? null,
      });
    }
  }

  return items;
}
