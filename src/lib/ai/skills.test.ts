import { describe, expect, it } from "vitest";
import { buildSkillPrompt, EMPLOYEE_DEFAULT_SKILL, GLOBAL_SKILL } from "./skills";
import type { EmployeeId } from "../boss-language";

const ALL_EMPLOYEES: EmployeeId[] = [
  "planner",
  "researcher",
  "video-editor",
  "xiaohongshu-editor",
  "wechat-editor",
  "image-designer",
  "compliance",
  "analyst",
];

describe("EMPLOYEE_DEFAULT_SKILL — every employee has a distinct Skill", () => {
  it("defines exactly the 8 real employees, no gaps", () => {
    expect(Object.keys(EMPLOYEE_DEFAULT_SKILL).sort()).toEqual([...ALL_EMPLOYEES].sort());
  });

  it("every employee's Skill is non-empty and distinct from every other employee's", () => {
    const texts = ALL_EMPLOYEES.map((id) => EMPLOYEE_DEFAULT_SKILL[id]);
    for (const text of texts) expect(text.trim().length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(ALL_EMPLOYEES.length);
  });
});

describe("buildSkillPrompt — Global Skill inheritance", () => {
  it("includes the full GLOBAL_SKILL text for every employee", () => {
    for (const id of ALL_EMPLOYEES) {
      expect(buildSkillPrompt(id, "任务专属指令")).toContain(GLOBAL_SKILL);
    }
  });
});

describe("buildSkillPrompt — employee-specific Skill resolution", () => {
  it("includes the requested employee's own Skill text", () => {
    for (const id of ALL_EMPLOYEES) {
      expect(buildSkillPrompt(id, "任务专属指令")).toContain(EMPLOYEE_DEFAULT_SKILL[id]);
    }
  });

  it("does not include a different employee's Skill text", () => {
    const prompt = buildSkillPrompt("planner", "任务专属指令");
    expect(prompt).not.toContain(EMPLOYEE_DEFAULT_SKILL.researcher);
    expect(prompt).not.toContain(EMPLOYEE_DEFAULT_SKILL.compliance);
  });
});

describe("buildSkillPrompt — composition order", () => {
  it("places GLOBAL_SKILL before the employee Skill, and the task prompt last", () => {
    const taskPrompt = "这是任务专属的输出格式说明";
    const prompt = buildSkillPrompt("compliance", taskPrompt);

    const globalIndex = prompt.indexOf(GLOBAL_SKILL);
    const employeeIndex = prompt.indexOf(EMPLOYEE_DEFAULT_SKILL.compliance);
    const taskIndex = prompt.indexOf(taskPrompt);

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(employeeIndex).toBeGreaterThan(globalIndex);
    expect(taskIndex).toBeGreaterThan(employeeIndex);
  });
});
