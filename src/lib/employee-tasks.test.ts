import { describe, expect, it } from "vitest";
import {
  buildHomeSpotlight,
  buildLeoReviewQueue,
  filterContentEligibleTopics,
  summarizeEditorTasks,
  summarizePlannerTasks,
  summarizeResearcherTasks,
} from "./employee-tasks";
import type { ComplianceQueueItem, ReviewItem } from "./employee-tasks";
import type { ContentAsset, Topic } from "./types";

function makeTopic(overrides: Partial<Topic>): Topic {
  return {
    id: "topic-1",
    code: "T-0001",
    title: "示例选题",
    question: "问题",
    business: "",
    audience: "",
    content_pillar: null,
    priority: "MEDIUM",
    topic_score: 50,
    score_breakdown: { priority: 35, completeness: 15 },
    status: "IDEA",
    created_by: null,
    published_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAsset(overrides: Partial<ContentAsset>): ContentAsset {
  return {
    id: "asset-1",
    topic_id: "topic-1",
    research_pack_id: "pack-1",
    platform: "VIDEO_CHANNEL",
    content_type: "video_script",
    title: "标题",
    content: "内容",
    structured_content: {},
    version: 1,
    status: "DRAFT",
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("summarizePlannerTasks — employee task aggregation", () => {
  it("counts total library topics and how many are HIGH priority", () => {
    const topics = [
      makeTopic({ id: "1", priority: "HIGH" }),
      makeTopic({ id: "2", priority: "MEDIUM" }),
      makeTopic({ id: "3", priority: "HIGH" }),
    ];
    expect(summarizePlannerTasks(topics)).toEqual({ todayCandidates: 3, highPriority: 2 });
  });

  it("handles an empty library", () => {
    expect(summarizePlannerTasks([])).toEqual({ todayCandidates: 0, highPriority: 0 });
  });
});

describe("summarizeResearcherTasks", () => {
  it("separates in-progress from awaiting-review counts", () => {
    const topics = [
      makeTopic({ id: "1", status: "RESEARCHING" }),
      makeTopic({ id: "2", status: "RESEARCHING" }),
      makeTopic({ id: "3", status: "RESEARCH_READY" }),
      makeTopic({ id: "4", status: "IDEA" }),
    ];
    expect(summarizeResearcherTasks(topics)).toEqual({ inProgress: 2, awaitingReview: 1 });
  });
});

describe("filterContentEligibleTopics / summarizeEditorTasks", () => {
  it("only includes topics at RESEARCH_APPROVED or later", () => {
    const topics = [
      makeTopic({ id: "1", status: "RESEARCH_READY" }),
      makeTopic({ id: "2", status: "RESEARCH_APPROVED" }),
      makeTopic({ id: "3", status: "CONTENT_DRAFT" }),
      makeTopic({ id: "4", status: "PUBLISHED" }),
      makeTopic({ id: "5", status: "ARCHIVED" }),
    ];
    const eligible = filterContentEligibleTopics(topics);
    expect(eligible.map((t) => t.id)).toEqual(["2", "3", "4"]);
  });

  it("counts a topic as drafts-complete once it has at least one asset, pending otherwise", () => {
    const eligible = [makeTopic({ id: "1" }), makeTopic({ id: "2" }), makeTopic({ id: "3" })];
    const byTopic = new Map<string, ContentAsset[]>([
      ["1", [makeAsset({ topic_id: "1" })]],
      // topic "2" has no entry at all — pending
      ["3", []], // present but empty — still pending
    ]);
    expect(summarizeEditorTasks(eligible, byTopic, "VIDEO_CHANNEL")).toEqual({
      pendingGeneration: 2,
      draftsComplete: 1,
    });
  });
});

describe("buildLeoReviewQueue — Leo review queue aggregation", () => {
  it("includes every RESEARCH_READY topic as a researcher item", () => {
    const topics = [makeTopic({ id: "1", status: "RESEARCH_READY", title: "选题A" })];
    const queue = buildLeoReviewQueue(topics, new Map());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ topicId: "1", employeeId: "researcher", topicTitle: "选题A" });
  });

  it("attaches a warning when the topic's research confidence is LOW", () => {
    const topics = [makeTopic({ id: "1", status: "RESEARCH_READY" })];
    const confidence = new Map([["1", "LOW" as const]]);
    const queue = buildLeoReviewQueue(topics, new Map(), confidence);
    expect(queue[0].warning).toBe("证据不足，需要重点确认");
  });

  it("does not attach a warning for HIGH confidence", () => {
    const topics = [makeTopic({ id: "1", status: "RESEARCH_READY" })];
    const confidence = new Map([["1", "HIGH" as const]]);
    const queue = buildLeoReviewQueue(topics, new Map(), confidence);
    expect(queue[0].warning).toBeNull();
  });

  it("includes a topic as an editor item only when its latest content has real expert_review_notes", () => {
    const topics = [makeTopic({ id: "1", status: "CONTENT_DRAFT", title: "选题B" })];
    const assets = new Map<string, ContentAsset[]>([
      [
        "1",
        [
          makeAsset({
            id: "a1",
            topic_id: "1",
            version: 1,
            structured_content: { expert_review_notes: [{ claim: "x", reason: "research_gap", note: "n" }] },
          }),
        ],
      ],
    ]);
    const queue = buildLeoReviewQueue(topics, assets);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      topicId: "1",
      employeeId: "video-editor",
      description: "内容草稿有 1 项需要确认",
    });
  });

  it("does NOT fabricate an editor item when expert_review_notes is empty", () => {
    const topics = [makeTopic({ id: "1", status: "CONTENT_DRAFT" })];
    const assets = new Map<string, ContentAsset[]>([
      ["1", [makeAsset({ id: "a1", topic_id: "1", structured_content: { expert_review_notes: [] } })]],
    ]);
    expect(buildLeoReviewQueue(topics, assets)).toHaveLength(0);
  });

  it("only counts the LATEST version's notes per lineage, not every historical version", () => {
    const topics = [makeTopic({ id: "1", status: "CONTENT_DRAFT" })];
    const assets = new Map<string, ContentAsset[]>([
      [
        "1",
        [
          makeAsset({
            id: "v1",
            topic_id: "1",
            version: 1,
            structured_content: { expert_review_notes: [{ claim: "old", reason: "research_gap", note: "n" }] },
          }),
          makeAsset({
            id: "v2",
            topic_id: "1",
            version: 2,
            structured_content: { expert_review_notes: [] },
          }),
        ],
      ],
    ]);
    // v2 is latest and has zero notes, so nothing should surface even
    // though v1 (superseded) had one.
    expect(buildLeoReviewQueue(topics, assets)).toHaveLength(0);
  });

  it("returns an empty queue when nothing needs Leo", () => {
    const topics = [makeTopic({ id: "1", status: "IDEA" }), makeTopic({ id: "2", status: "PUBLISHED" })];
    expect(buildLeoReviewQueue(topics, new Map())).toEqual([]);
  });
});

describe("buildHomeSpotlight", () => {
  const researchItem: ReviewItem = {
    topicId: "1",
    topicTitle: "研究选题",
    employeeId: "researcher",
    employeeName: "政策研究员",
    description: "研究已完成，请确认是否可以使用",
    warning: null,
    href: "/topics/1/research/review",
  };
  const contentItem: ReviewItem = {
    topicId: "2",
    topicTitle: "内容选题",
    employeeId: "video-editor",
    employeeName: "视频口播文案编辑员",
    description: "内容草稿有 1 项需要确认",
    warning: null,
    href: "/topics/2?tab=video",
  };
  const complianceItem: ComplianceQueueItem = {
    topicId: "3",
    topicTitle: "合规选题",
    contentAssetId: "asset-3",
    platformLabel: "VIDEO_CHANNEL",
    latestReview: null,
  };

  it("prioritizes a research item awaiting confirmation above everything else", () => {
    const result = buildHomeSpotlight([researchItem, contentItem], [complianceItem], { todayCandidates: 0, highPriority: 0 });
    expect(result?.employeeId).toBe("researcher");
    expect(result?.title).toBe("研究选题");
    expect(result?.href).toBe("/topics/1/research/review");
  });

  it("falls back to a compliance item when no research item is pending", () => {
    const result = buildHomeSpotlight([contentItem], [complianceItem], { todayCandidates: 0, highPriority: 0 });
    expect(result?.employeeId).toBe("compliance");
    expect(result?.title).toBe("合规选题");
  });

  it("falls back to a content-editor item when no research or compliance item is pending", () => {
    const result = buildHomeSpotlight([contentItem], [], { todayCandidates: 0, highPriority: 0 });
    expect(result?.employeeId).toBe("video-editor");
    expect(result?.title).toBe("内容选题");
  });

  it("prompts to search for topics when the queue is empty and nothing was searched today", () => {
    const result = buildHomeSpotlight([], [], { todayCandidates: 0, highPriority: 0 });
    expect(result?.employeeId).toBe("planner");
    expect(result?.href).toBe("/team/planner");
  });

  it("returns null — never fabricates a spotlight — when there's genuinely nothing to do", () => {
    const result = buildHomeSpotlight([], [], { todayCandidates: 3, highPriority: 1 });
    expect(result).toBeNull();
  });
});
