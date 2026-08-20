import { describe, expect, it } from "vitest";
import {
  BOSS_CONFIDENCE_LABEL,
  BOSS_STATUS_LABEL,
  DIGITAL_EMPLOYEES,
  getEmployee,
  resolveEmployeeDisplayName,
  timeBasedGreeting,
} from "./boss-language";
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

describe("BOSS_STATUS_LABEL — status label mapping", () => {
  it("has a boss-friendly label for every status, with no raw enum name leaking through", () => {
    for (const status of ALL_STATUSES) {
      const label = BOSS_STATUS_LABEL[status];
      expect(label).toBeTruthy();
      expect(label).not.toBe(status);
      expect(label).not.toContain("_");
    }
  });

  it("matches the specific phrasing requested for the key statuses", () => {
    expect(BOSS_STATUS_LABEL.RESEARCH_READY).toBe("研究完成，等你确认");
    expect(BOSS_STATUS_LABEL.RESEARCH_APPROVED).toBe("研究已确认");
    expect(BOSS_STATUS_LABEL.CONTENT_DRAFT).toBe("内容草稿已完成");
    expect(BOSS_STATUS_LABEL.READY_TO_SHOOT).toBe("可以拍摄");
    expect(BOSS_STATUS_LABEL.PUBLISHED).toBe("已发布");
  });
});

describe("BOSS_CONFIDENCE_LABEL", () => {
  it("translates every confidence level into plain language", () => {
    expect(BOSS_CONFIDENCE_LABEL.LOW).toBe("证据不足，需要重点确认");
    expect(BOSS_CONFIDENCE_LABEL.MEDIUM).toBe("部分内容需要确认");
    expect(BOSS_CONFIDENCE_LABEL.HIGH).toBe("证据较充分");
  });
});

describe("DIGITAL_EMPLOYEES", () => {
  it("defines exactly five employees, lettered A-E in order", () => {
    expect(DIGITAL_EMPLOYEES).toHaveLength(5);
    expect(DIGITAL_EMPLOYEES.map((e) => e.letter)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("all five are enabled — Compliance and Analyst went live by explicit user instruction", () => {
    expect(DIGITAL_EMPLOYEES.every((e) => e.enabled)).toBe(true);
  });

  it("getEmployee looks up a specific employee by id", () => {
    expect(getEmployee("researcher").letter).toBe("B");
    expect(getEmployee("researcher").name).toBe("政策研究员");
  });

  it("getEmployee throws for an unknown id rather than returning undefined", () => {
    // @ts-expect-error - intentionally invalid id to test the guard
    expect(() => getEmployee("nonexistent")).toThrow();
  });
});

describe("resolveEmployeeDisplayName", () => {
  it("falls back to the default name when no custom name is set", () => {
    expect(resolveEmployeeDisplayName("researcher", {})).toBe("政策研究员");
  });

  it("prefers a custom name when one is set", () => {
    expect(resolveEmployeeDisplayName("researcher", { researcher: "小研" })).toBe("小研");
  });
});

describe("timeBasedGreeting", () => {
  it("greets morning before noon", () => {
    expect(timeBasedGreeting(0)).toBe("早上好");
    expect(timeBasedGreeting(11)).toBe("早上好");
  });

  it("greets afternoon from noon to before 18:00", () => {
    expect(timeBasedGreeting(12)).toBe("下午好");
    expect(timeBasedGreeting(17)).toBe("下午好");
  });

  it("greets evening from 18:00 onward", () => {
    expect(timeBasedGreeting(18)).toBe("晚上好");
    expect(timeBasedGreeting(23)).toBe("晚上好");
  });
});
