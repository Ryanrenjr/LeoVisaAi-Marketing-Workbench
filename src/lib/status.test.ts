import { describe, expect, it } from "vitest";
import { startOfCurrentWeek, STATUS_LABEL } from "./status";

describe("STATUS_LABEL", () => {
  it("has a Chinese label for every status", () => {
    expect(STATUS_LABEL.IDEA).toBe("选题构思");
    expect(STATUS_LABEL.RESEARCHING).toBe("研究中");
    expect(STATUS_LABEL.RESEARCH_APPROVED).toBe("研究已完成");
    expect(STATUS_LABEL.READY_TO_SHOOT).toBe("可进入拍摄");
    expect(STATUS_LABEL.PUBLISHED).toBe("已发布");
    expect(STATUS_LABEL.ARCHIVED).toBe("已归档");
  });
});

describe("startOfCurrentWeek", () => {
  it("returns the preceding Monday at midnight", () => {
    // Thursday 2026-08-20
    const thursday = new Date("2026-08-20T15:30:00");
    const monday = startOfCurrentWeek(thursday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(17);
    expect(monday.getHours()).toBe(0);
  });

  it("treats Sunday as the end of the same week, not a new one", () => {
    const sunday = new Date("2026-08-23T09:00:00");
    const monday = startOfCurrentWeek(sunday);
    expect(monday.getDate()).toBe(17);
  });

  it("returns itself at midnight when given a Monday", () => {
    const monday = new Date("2026-08-17T08:00:00");
    const start = startOfCurrentWeek(monday);
    expect(start.getDate()).toBe(17);
    expect(start.getHours()).toBe(0);
  });
});
