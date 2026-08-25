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
  LEO_REVIEW: "等待你确认",
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

/**
 * Plain-language framing for `topics.topic_score` (0-100, see
 * src/lib/scoring.ts computeTopicScore) — distinct from
 * BOSS_CONFIDENCE_LABEL, which is about the RESEARCH result's evidentiary
 * strength, not the topic itself. Thresholds are deliberately coarse —
 * this is a plain-language nudge, not a precise cutoff.
 */
export function bossScoreLabel(score: number): string {
  if (score >= 80) return "优质选题，建议优先推进";
  if (score >= 50) return "选题可用，问题不大";
  return "选题信息不完整，建议先完善后再研究";
}

export type EmployeeId =
  | "planner"
  | "researcher"
  | "video-editor"
  | "xiaohongshu-editor"
  | "image-designer"
  | "wechat-editor"
  | "compliance"
  | "reviser"
  | "integrator"
  | "analyst"
  | "xiaohongshu-image-planner";

export interface DigitalEmployee {
  id: EmployeeId;
  letter: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";
  name: string;
  responsibility: string;
  href: string;
  enabled: boolean;
}

/**
 * Eleven digital employees. Originally five (planner/researcher/editor/
 * compliance/analyst) — "编辑" (content editor) was split into three
 * platform-specific employees (video-editor/xiaohongshu-editor/
 * wechat-editor) plus a new image-designer, by explicit live user
 * instruction: different platforms need visibly different working styles,
 * not one generic "editor" doing all three. `reviser` (H) was added next,
 * also by explicit live user instruction: after compliance (G) flags an
 * issue, someone needs to actually fix it — reviser produces a revised
 * draft addressing exactly what was flagged, still subject to human
 * review before publish (see revision-actions.ts). `integrator` (I) came
 * next, also explicit live user instruction: text and cover images for
 * one platform are produced by different employees on different pages,
 * so before Leo's final look there needs to be one place that shows the
 * assembled package per platform (text + cover, plus carousel images for
 * Xiaohongshu) — integrator never generates or changes anything, it's a
 * pure read-only assembly view (see /team/integrator/page.tsx).
 * `xiaohongshu-image-planner` (K) split off from `xiaohongshu-editor` (D)
 * last, also explicit live user instruction: title/caption writing and
 * per-page image-text planning are different skills — D now owns only
 * title_options/cover_title/caption/keywords, K owns the page plan
 * (XiaohongshuPagesPlanSchema, content + design-direction cues per page).
 * K does NOT generate the images itself — a follow-up live-user
 * correction moved that back to `image-designer` (E), which reads K's
 * plan and has its own "生成小红书图文" button (see
 * generateXiaohongshuCarousel in team/image-designer/actions.ts) — K only
 * ever produces the text plan. `name` here is the default; a signed-in
 * ADMIN can override it per employee via
 * employee_names (see src/lib/employee-names.ts) — always resolve display
 * names through resolveEmployeeDisplayName, not this array directly.
 */
export const DIGITAL_EMPLOYEES: readonly DigitalEmployee[] = [
  {
    id: "planner",
    letter: "A",
    name: "选题策划员",
    responsibility: "帮你决定今天最值得做什么内容，还能主动搜今天的新闻找选题。",
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
    id: "video-editor",
    letter: "C",
    name: "视频口播文案编辑员",
    responsibility: "把审核过的研究写成视频号口播文案。",
    href: "/team/video-editor",
    enabled: true,
  },
  {
    id: "xiaohongshu-editor",
    letter: "D",
    name: "小红书标题文案员",
    responsibility: "把审核过的研究写成小红书标题和发布文案（图文内页的内容由图文规划员另外负责）。",
    href: "/team/xiaohongshu-editor",
    enabled: true,
  },
  {
    id: "image-designer",
    letter: "E",
    name: "小红书图片设计员",
    responsibility: "根据小红书/视频文案和公众号文章生成封面图，也根据图文规划员写好的规划生成小红书图文（P1-P6）配图。",
    href: "/team/image-designer",
    enabled: true,
  },
  {
    id: "wechat-editor",
    letter: "F",
    name: "公众号长文编辑员",
    responsibility: "把审核过的研究直接写成公众号长文文案。",
    href: "/team/wechat-editor",
    enabled: true,
  },
  {
    id: "compliance",
    letter: "G",
    name: "合规审核员",
    responsibility: "专门挑错，重新核对内容有没有超出研究依据、有没有风险用语。",
    href: "/team/compliance",
    enabled: true,
  },
  {
    id: "reviser",
    letter: "H",
    name: "终审修改员",
    responsibility: "合规审核员标出问题后，把被标出的地方改好，出一版新的草稿给你确认。",
    href: "/team/reviser",
    enabled: true,
  },
  {
    id: "integrator",
    letter: "I",
    name: "内容整合员",
    responsibility: "把每个平台改好的文字和配图放在一起，让你一眼看到最终成品，再决定要不要进入拍摄。",
    href: "/team/integrator",
    enabled: true,
  },
  {
    id: "analyst",
    letter: "J",
    name: "数据分析员",
    responsibility: "看发布后的数据表现，帮你判断下次该往哪个方向选题。",
    href: "/team/analyst",
    enabled: true,
  },
  {
    id: "xiaohongshu-image-planner",
    letter: "K",
    name: "小红书图文规划员",
    responsibility: "规划小红书图文每一页写什么、怎么设计（配图由小红书图片设计员负责生成，标题和发布文案由小红书标题文案员负责）。",
    href: "/team/xiaohongshu-image-planner",
    enabled: true,
  },
];

export function getEmployee(id: EmployeeId): DigitalEmployee {
  const employee = DIGITAL_EMPLOYEES.find((e) => e.id === id);
  if (!employee) throw new Error(`Unknown digital employee: ${id}`);
  return employee;
}

/**
 * The name to actually display: an ADMIN-set custom name if one exists,
 * otherwise the default from DIGITAL_EMPLOYEES. Pure — callers fetch
 * `customNames` once (getEmployeeNames() in employee-names.ts) and pass it
 * in, so every page resolves names the same way.
 */
export function resolveEmployeeDisplayName(
  id: EmployeeId,
  customNames: Partial<Record<EmployeeId, string>>,
): string {
  return customNames[id] || getEmployee(id).name;
}

/** `hour` is 0-23, server local time. */
export function timeBasedGreeting(hour: number): string {
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
