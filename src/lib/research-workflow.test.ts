import { describe, expect, it } from "vitest";
import { canApproveResearchFromStatus, canRunResearchFromStatus } from "./research-workflow";
import type { TopicStatus } from "./types";

const ALL_STATUSES: TopicStatus[] = [
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
  "ARCHIVED",
];

describe("canRunResearchFromStatus", () => {
  it("allows running research while RESEARCHING or RESEARCH_READY", () => {
    expect(canRunResearchFromStatus("RESEARCHING")).toBe(true);
    expect(canRunResearchFromStatus("RESEARCH_READY")).toBe(true);
  });

  it("disallows every other status", () => {
    const disallowed = ALL_STATUSES.filter((s) => s !== "RESEARCHING" && s !== "RESEARCH_READY");
    for (const status of disallowed) {
      expect(canRunResearchFromStatus(status)).toBe(false);
    }
  });
});

describe("canApproveResearchFromStatus", () => {
  it("allows approval only from RESEARCH_READY", () => {
    expect(canApproveResearchFromStatus("RESEARCH_READY")).toBe(true);
  });

  it("disallows approval from RESEARCHING (no pack to review yet)", () => {
    expect(canApproveResearchFromStatus("RESEARCHING")).toBe(false);
  });

  it("disallows approval once already RESEARCH_APPROVED (no double-approval)", () => {
    expect(canApproveResearchFromStatus("RESEARCH_APPROVED")).toBe(false);
  });

  it("disallows approval for every other status", () => {
    const disallowed = ALL_STATUSES.filter((s) => s !== "RESEARCH_READY");
    for (const status of disallowed) {
      expect(canApproveResearchFromStatus(status)).toBe(false);
    }
  });
});
