import { describe, expect, it } from "vitest";
import {
  canArchive,
  canStartResearch,
  isAllowedTransition,
  isAtOrPastStage,
  nextStatus,
} from "./topic-workflow";

describe("nextStatus", () => {
  it("advances through the full pipeline in order", () => {
    expect(nextStatus("IDEA")).toBe("RESEARCHING");
    expect(nextStatus("RESEARCHING")).toBe("RESEARCH_READY");
    expect(nextStatus("RESEARCH_READY")).toBe("RESEARCH_APPROVED");
    expect(nextStatus("RESEARCH_APPROVED")).toBe("CONTENT_DRAFT");
    expect(nextStatus("CONTENT_DRAFT")).toBe("COMPLIANCE_REVIEW");
    expect(nextStatus("COMPLIANCE_REVIEW")).toBe("LEO_REVIEW");
    expect(nextStatus("LEO_REVIEW")).toBe("APPROVED");
    expect(nextStatus("APPROVED")).toBe("READY_TO_SHOOT");
    expect(nextStatus("READY_TO_SHOOT")).toBe("PUBLISHED");
  });

  it("returns null once a topic is published or archived", () => {
    expect(nextStatus("PUBLISHED")).toBeNull();
    expect(nextStatus("ARCHIVED")).toBeNull();
  });
});

describe("isAllowedTransition", () => {
  it("allows starting research from IDEA", () => {
    expect(isAllowedTransition("IDEA", "RESEARCHING")).toBe(true);
  });

  it("disallows skipping stages", () => {
    expect(isAllowedTransition("IDEA", "PUBLISHED")).toBe(false);
    expect(isAllowedTransition("IDEA", "RESEARCH_APPROVED")).toBe(false);
    expect(isAllowedTransition("RESEARCH_APPROVED", "READY_TO_SHOOT")).toBe(false);
  });

  it("disallows moving backwards", () => {
    expect(isAllowedTransition("RESEARCHING", "IDEA")).toBe(false);
    expect(isAllowedTransition("RESEARCH_APPROVED", "RESEARCH_READY")).toBe(false);
  });

  it("allows archiving from any active stage, including the new mid-pipeline ones", () => {
    expect(isAllowedTransition("IDEA", "ARCHIVED")).toBe(true);
    expect(isAllowedTransition("RESEARCHING", "ARCHIVED")).toBe(true);
    expect(isAllowedTransition("CONTENT_DRAFT", "ARCHIVED")).toBe(true);
    expect(isAllowedTransition("COMPLIANCE_REVIEW", "ARCHIVED")).toBe(true);
    expect(isAllowedTransition("PUBLISHED", "ARCHIVED")).toBe(true);
  });

  it("disallows any transition out of ARCHIVED", () => {
    expect(isAllowedTransition("ARCHIVED", "IDEA")).toBe(false);
    expect(isAllowedTransition("ARCHIVED", "ARCHIVED")).toBe(false);
  });
});

describe("canStartResearch", () => {
  it("is true only for IDEA", () => {
    expect(canStartResearch("IDEA")).toBe(true);
    expect(canStartResearch("RESEARCHING")).toBe(false);
    expect(canStartResearch("PUBLISHED")).toBe(false);
  });
});

describe("canArchive", () => {
  it("is true for any non-archived status", () => {
    expect(canArchive("IDEA")).toBe(true);
    expect(canArchive("PUBLISHED")).toBe(true);
  });

  it("is false once already archived", () => {
    expect(canArchive("ARCHIVED")).toBe(false);
  });
});

describe("isAtOrPastStage", () => {
  it("is false before the milestone", () => {
    expect(isAtOrPastStage("IDEA", "RESEARCH_APPROVED")).toBe(false);
    expect(isAtOrPastStage("RESEARCHING", "RESEARCH_APPROVED")).toBe(false);
    expect(isAtOrPastStage("RESEARCH_READY", "RESEARCH_APPROVED")).toBe(false);
  });

  it("is true at the milestone and every stage after it", () => {
    expect(isAtOrPastStage("RESEARCH_APPROVED", "RESEARCH_APPROVED")).toBe(true);
    expect(isAtOrPastStage("CONTENT_DRAFT", "RESEARCH_APPROVED")).toBe(true);
    expect(isAtOrPastStage("LEO_REVIEW", "RESEARCH_APPROVED")).toBe(true);
    expect(isAtOrPastStage("PUBLISHED", "RESEARCH_APPROVED")).toBe(true);
  });

  it("is false for an archived topic even if it was past the milestone before archiving", () => {
    expect(isAtOrPastStage("ARCHIVED", "RESEARCH_APPROVED")).toBe(false);
  });
});
