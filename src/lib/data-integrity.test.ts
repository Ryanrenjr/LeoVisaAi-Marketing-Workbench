import { describe, expect, it } from "vitest";
import { findResearchIntegrityIssues } from "./data-integrity";

describe("findResearchIntegrityIssues", () => {
  it("flags a topic at RESEARCH_READY or later with no research_packs row", () => {
    const topics = [{ id: "t1", code: "T-0001", title: "标题", status: "RESEARCH_APPROVED" as const }];
    const issues = findResearchIntegrityIssues(topics, new Set(), new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0].issue).toBe("missing_research_pack");
  });

  it("does not flag a topic that genuinely has a research pack", () => {
    const topics = [{ id: "t1", code: "T-0001", title: "标题", status: "RESEARCH_APPROVED" as const }];
    const issues = findResearchIntegrityIssues(topics, new Set(["t1"]), new Set());
    expect(issues.find((i) => i.issue === "missing_research_pack")).toBeUndefined();
  });

  it("does not flag an early-stage topic (IDEA/RESEARCHING) for a missing research pack", () => {
    const topics = [
      { id: "t1", code: "T-0001", title: "标题", status: "IDEA" as const },
      { id: "t2", code: "T-0002", title: "标题2", status: "RESEARCHING" as const },
    ];
    const issues = findResearchIntegrityIssues(topics, new Set(), new Set());
    expect(issues).toHaveLength(0);
  });

  it("flags a topic at CONTENT_DRAFT or later with no content_assets row, independently of the research check", () => {
    const topics = [{ id: "t1", code: "T-0001", title: "标题", status: "CONTENT_DRAFT" as const }];
    const issues = findResearchIntegrityIssues(topics, new Set(["t1"]), new Set());
    expect(issues).toEqual([
      { topicId: "t1", code: "T-0001", title: "标题", status: "CONTENT_DRAFT", issue: "missing_content_asset" },
    ]);
  });

  it("can flag both issues for the same topic", () => {
    const topics = [{ id: "t1", code: "T-0001", title: "标题", status: "PUBLISHED" as const }];
    const issues = findResearchIntegrityIssues(topics, new Set(), new Set());
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.issue).sort()).toEqual(["missing_content_asset", "missing_research_pack"]);
  });
});
