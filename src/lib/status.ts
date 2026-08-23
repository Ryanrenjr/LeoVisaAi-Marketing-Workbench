import type {
  ContentPillar,
  ContentPlatform,
  ContentType,
  ResearchConfidence,
  TopicActivityType,
  TopicPriority,
  TopicStatus,
} from "./types";

interface StageConfig {
  status: TopicStatus;
  label: string;
  href: string;
}

/** The pipeline stages that have a dedicated list page. */
export const PIPELINE_STAGES: readonly StageConfig[] = [
  { status: "RESEARCH_APPROVED", label: "研究已完成", href: "/research-completed" },
  { status: "READY_TO_SHOOT", label: "可进入拍摄", href: "/ready-to-shoot" },
  { status: "PUBLISHED", label: "本周已发布", href: "/published" },
];

export const STATUS_LABEL: Record<TopicStatus, string> = {
  IDEA: "选题构思",
  RESEARCHING: "研究中",
  RESEARCH_READY: "研究待审核",
  RESEARCH_APPROVED: "研究已完成",
  CONTENT_DRAFT: "内容草稿",
  COMPLIANCE_REVIEW: "合规审核",
  LEO_REVIEW: "最终确认",
  APPROVED: "已批准",
  READY_TO_SHOOT: "可进入拍摄",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

export const CONTENT_PILLAR_LABEL: Record<ContentPillar, string> = {
  policy_update: "政策解读",
  myth_busting: "误区澄清",
  how_to: "操作指南",
  case_study: "案例分享",
  news: "时事快讯",
};

export const PRIORITY_LABEL: Record<TopicPriority, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
};

export const CONFIDENCE_LABEL: Record<ResearchConfidence, string> = {
  LOW: "置信度：低",
  MEDIUM: "置信度：中",
  HIGH: "置信度：高",
};

export const TOPIC_ACTIVITY_LABEL: Record<TopicActivityType, string> = {
  topic_created: "创建了选题",
  topic_edited: "编辑了选题",
  topic_scored: "重新评分",
  score_manually_changed: "手动修改了评分",
  research_requested: "开始研究",
  topic_archived: "归档了选题",
  research_run_started: "开始运行研究",
  research_run_completed: "研究运行完成",
  research_run_failed: "研究运行失败",
  research_edited: "编辑了研究成果",
  research_approved: "批准了研究",
  research_changes_requested: "请求修改研究",
  content_generation_started: "开始生成内容",
  content_generated: "生成了内容",
  content_generation_failed: "内容生成失败",
  content_regenerated: "重新生成了内容",
  content_edited: "编辑了内容草稿",
  full_article_generated: "生成了公众号完整文章",
};

export const CONTENT_PLATFORM_LABEL: Record<ContentPlatform, string> = {
  VIDEO_CHANNEL: "视频号",
  XIAOHONGSHU: "小红书",
  WECHAT_OFFICIAL_ACCOUNT: "公众号",
};

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  video_script: "视频号脚本",
  xiaohongshu_post: "小红书笔记",
  wechat_outline: "公众号大纲",
  wechat_full_article: "公众号完整文章",
};

/** Start (Monday 00:00) of the current calendar week, in the server's local time. */
export function startOfCurrentWeek(now: Date = new Date()): Date {
  const start = new Date(now);
  const day = start.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}
