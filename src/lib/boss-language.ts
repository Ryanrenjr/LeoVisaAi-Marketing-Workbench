import type { ResearchConfidence, TopicStatus } from "./types";

/**
 * Boss-Mode-only Chinese copy — deliberately separate from status.ts's
 * STATUS_LABEL/CONFIDENCE_LABEL (which stay as-is for Admin Mode and
 * every existing page). No raw enum name, workflow term, or technical
 * concept should ever reach Boss Mode; see docs/digital-employee-ux.md.
 */

export const BOSS_STATUS_LABEL: Record<TopicStatus, string> = {
  IDEA: "选题构思中",
  RESEARCHING: "研究中",
  RESEARCH_READY: "研究完成，等你确认",
  RESEARCH_APPROVED: "研究已确认",
  CONTENT_DRAFT: "内容草稿已完成",
  COMPLIANCE_REVIEW: "合规审核中",
  LEO_REVIEW: "等待Leo审核",
  APPROVED: "已批准",
  READY_TO_SHOOT: "可以拍摄",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

export const BOSS_CONFIDENCE_LABEL: Record<ResearchConfidence, string> = {
  LOW: "证据不足，需要重点确认",
  MEDIUM: "部分内容需要确认",
  HIGH: "证据较充分",
};

export type EmployeeId = "planner" | "researcher" | "editor" | "compliance";

export interface DigitalEmployee {
  id: EmployeeId;
  letter: "A" | "B" | "C" | "D";
  name: string;
  responsibility: string;
  href: string;
  /** Compliance is not implemented yet — see CLAUDE.md. */
  enabled: boolean;
}

/** Exactly four digital employees this phase — do not add a fifth without instruction. */
export const DIGITAL_EMPLOYEES: readonly DigitalEmployee[] = [
  {
    id: "planner",
    letter: "A",
    name: "选题策划员",
    responsibility: "帮你决定今天最值得做什么内容。",
    href: "/team/planner",
    enabled: true,
  },
  {
    id: "researcher",
    letter: "B",
    name: "政策研究员",
    responsibility: "帮你查官方规则、找依据、整理结论。",
    href: "/team/researcher",
    enabled: true,
  },
  {
    id: "editor",
    letter: "C",
    name: "内容编辑",
    responsibility: "把审核过的研究变成视频号、小红书和公众号内容。",
    href: "/team/editor",
    enabled: true,
  },
  {
    id: "compliance",
    letter: "D",
    name: "合规审核员",
    responsibility: "专门挑错，检查内容有没有风险。",
    href: "/team/compliance",
    enabled: false,
  },
];

export function getEmployee(id: EmployeeId): DigitalEmployee {
  const employee = DIGITAL_EMPLOYEES.find((e) => e.id === id);
  if (!employee) throw new Error(`Unknown digital employee: ${id}`);
  return employee;
}

/** `hour` is 0-23, server local time. */
export function timeBasedGreeting(hour: number): string {
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
