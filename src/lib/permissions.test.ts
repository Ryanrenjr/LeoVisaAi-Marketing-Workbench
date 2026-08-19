import { describe, expect, it } from "vitest";
import {
  canApproveResearch,
  canArchiveTopic,
  canGenerateContent,
  canManageContentAssets,
  canRunResearch,
} from "./permissions";

describe("canArchiveTopic", () => {
  it("allows ADMIN to archive topics", () => {
    expect(canArchiveTopic("ADMIN")).toBe(true);
  });

  it("does not allow EXPERT to archive topics", () => {
    expect(canArchiveTopic("EXPERT")).toBe(false);
  });
});

describe("canRunResearch", () => {
  it("allows ADMIN to run research", () => {
    expect(canRunResearch("ADMIN")).toBe(true);
  });

  it("does not allow EXPERT to run research", () => {
    expect(canRunResearch("EXPERT")).toBe(false);
  });
});

describe("canApproveResearch", () => {
  it("allows EXPERT to approve research", () => {
    expect(canApproveResearch("EXPERT")).toBe(true);
  });

  it("does not allow ADMIN to approve its own research — two-person control", () => {
    expect(canApproveResearch("ADMIN")).toBe(false);
  });
});

describe("canGenerateContent", () => {
  it("blocks content generation before research is approved", () => {
    expect(canGenerateContent("IDEA")).toBe(false);
    expect(canGenerateContent("RESEARCHING")).toBe(false);
    expect(canGenerateContent("RESEARCH_READY")).toBe(false);
  });

  it("allows content generation once research is approved or at any later stage", () => {
    expect(canGenerateContent("RESEARCH_APPROVED")).toBe(true);
    expect(canGenerateContent("CONTENT_DRAFT")).toBe(true);
    expect(canGenerateContent("COMPLIANCE_REVIEW")).toBe(true);
    expect(canGenerateContent("LEO_REVIEW")).toBe(true);
    expect(canGenerateContent("APPROVED")).toBe(true);
    expect(canGenerateContent("READY_TO_SHOOT")).toBe(true);
    expect(canGenerateContent("PUBLISHED")).toBe(true);
  });

  it("blocks content generation for an archived topic", () => {
    expect(canGenerateContent("ARCHIVED")).toBe(false);
  });
});

describe("canManageContentAssets", () => {
  it("allows ADMIN to generate/regenerate/edit content", () => {
    expect(canManageContentAssets("ADMIN")).toBe(true);
  });

  it("does not allow EXPERT to generate/regenerate/edit content — view only this milestone", () => {
    expect(canManageContentAssets("EXPERT")).toBe(false);
  });
});
