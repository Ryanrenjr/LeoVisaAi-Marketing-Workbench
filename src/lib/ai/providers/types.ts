import type { ZodType } from "zod";
import type { EmployeeId } from "../../boss-language";

/**
 * Provider-agnostic types for the Model Router. No network calls, no
 * "server-only" import — this file is pure and directly unit-testable.
 * See docs/model-router.md for the overall architecture.
 */

export type AIProviderId = "ANTHROPIC" | "GOOGLE" | "GROQ" | "OPENROUTER";

export const AI_PROVIDER_IDS: readonly AIProviderId[] = ["ANTHROPIC", "GOOGLE", "GROQ", "OPENROUTER"];

/**
 * A digital employee is never tied to one model. A task type is the unit
 * the router actually routes: Digital Employee → Task Type → Router →
 * Provider → Model.
 */
export type TaskType =
  | "TOPIC_PLANNING"
  | "TOPIC_DISCOVERY"
  | "RESEARCH"
  | "VIDEO_WRITING"
  | "XIAOHONGSHU_WRITING"
  | "WECHAT_WRITING"
  | "WECHAT_FULL_ARTICLE"
  | "COMPLIANCE"
  | "PERFORMANCE_ANALYSIS";

export const TASK_TYPES: readonly TaskType[] = [
  "TOPIC_PLANNING",
  "TOPIC_DISCOVERY",
  "RESEARCH",
  "VIDEO_WRITING",
  "XIAOHONGSHU_WRITING",
  "WECHAT_WRITING",
  "WECHAT_FULL_ARTICLE",
  "COMPLIANCE",
  "PERFORMANCE_ANALYSIS",
];

/** Which digital employee each task type belongs to — for grouping in the Admin settings UI. */
export const TASK_TYPE_EMPLOYEE: Record<TaskType, EmployeeId> = {
  TOPIC_PLANNING: "planner",
  TOPIC_DISCOVERY: "planner",
  RESEARCH: "researcher",
  VIDEO_WRITING: "editor",
  XIAOHONGSHU_WRITING: "editor",
  WECHAT_WRITING: "editor",
  WECHAT_FULL_ARTICLE: "editor",
  COMPLIANCE: "compliance",
  PERFORMANCE_ANALYSIS: "analyst",
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  TOPIC_PLANNING: "选题分析",
  TOPIC_DISCOVERY: "今日选题搜索",
  RESEARCH: "联网研究",
  VIDEO_WRITING: "视频号",
  XIAOHONGSHU_WRITING: "小红书",
  WECHAT_WRITING: "公众号大纲",
  WECHAT_FULL_ARTICLE: "公众号完整文章",
  COMPLIANCE: "合规审核",
  PERFORMANCE_ANALYSIS: "发布数据分析",
};

/**
 * "FREE" here means "currently configured as a known free-tier / free
 * model option" — not a permanent guarantee. Provider pricing changes
 * frequently; see registry.ts `lastVerifiedAt` / `freeTierNote`.
 */
export type PricingType = "FREE" | "PAID" | "MIXED";

export const PRICING_LABEL: Record<PricingType, string> = {
  FREE: "免费层",
  PAID: "付费",
  MIXED: "可能产生费用",
};

export interface ModelRef {
  provider: AIProviderId;
  modelId: string;
}

export interface ModelRegistryEntry {
  provider: AIProviderId;
  modelId: string;
  displayName: string;
  pricingType: PricingType;
  supportsWebSearch: boolean;
  supportsStructuredOutput: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  /** Can read an image as input — required for PERFORMANCE_ANALYSIS (screenshot reading). */
  supportsVision: boolean;
  enabled: boolean;
  /** Preferred when AI_DEVELOPMENT_MODE is on and no explicit choice has been made. */
  developmentRecommended: boolean;
  dataPolicyNote: string;
  freeTierNote: string | null;
  pricingNote: string;
  lastVerifiedAt: string;
}

/** The normalized shape every provider returns, regardless of SDK. */
export interface AIExecutionResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  provider: AIProviderId;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  toolUsage?: { webSearchCount?: number };
}

/** Shared shape for a generic "generate structured content" provider call. */
export interface StructuredGenerationRequest<T> {
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
  maxTokens: number;
  modelId: string;
}
