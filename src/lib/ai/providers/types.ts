import type { ZodType } from "zod";
import type { EmployeeId } from "../../boss-language";

/**
 * Provider-agnostic types for the Model Router. No network calls, no
 * "server-only" import — this file is pure and directly unit-testable.
 * See docs/model-router.md for the overall architecture.
 */

export type AIProviderId = "ANTHROPIC" | "GOOGLE" | "GROQ" | "OPENROUTER" | "OPENAI";

export const AI_PROVIDER_IDS: readonly AIProviderId[] = ["ANTHROPIC", "GOOGLE", "GROQ", "OPENROUTER", "OPENAI"];

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
  | "XIAOHONGSHU_PAGES_PLANNING"
  | "IMAGE_GENERATION"
  | "WECHAT_WRITING"
  | "WECHAT_FULL_ARTICLE"
  | "WECHAT_ARTICLE_WRITING"
  | "COMPLIANCE"
  | "VIDEO_REVISION"
  | "XIAOHONGSHU_REVISION"
  | "XIAOHONGSHU_PAGES_REVISION"
  | "WECHAT_ARTICLE_REVISION";

export const TASK_TYPES: readonly TaskType[] = [
  "TOPIC_PLANNING",
  "TOPIC_DISCOVERY",
  "RESEARCH",
  "VIDEO_WRITING",
  "XIAOHONGSHU_WRITING",
  "XIAOHONGSHU_PAGES_PLANNING",
  "IMAGE_GENERATION",
  "WECHAT_WRITING",
  "WECHAT_FULL_ARTICLE",
  "WECHAT_ARTICLE_WRITING",
  "COMPLIANCE",
  "VIDEO_REVISION",
  "XIAOHONGSHU_REVISION",
  "XIAOHONGSHU_PAGES_REVISION",
  "WECHAT_ARTICLE_REVISION",
];

/** Which digital employee each task type belongs to — for grouping in the Admin settings UI. */
export const TASK_TYPE_EMPLOYEE: Record<TaskType, EmployeeId> = {
  TOPIC_PLANNING: "planner",
  TOPIC_DISCOVERY: "planner",
  RESEARCH: "researcher",
  VIDEO_WRITING: "video-editor",
  XIAOHONGSHU_WRITING: "xiaohongshu-editor",
  XIAOHONGSHU_PAGES_PLANNING: "xiaohongshu-image-planner",
  IMAGE_GENERATION: "image-designer",
  WECHAT_WRITING: "wechat-editor",
  WECHAT_FULL_ARTICLE: "wechat-editor",
  WECHAT_ARTICLE_WRITING: "wechat-editor",
  COMPLIANCE: "compliance",
  VIDEO_REVISION: "reviser",
  XIAOHONGSHU_REVISION: "reviser",
  XIAOHONGSHU_PAGES_REVISION: "reviser",
  WECHAT_ARTICLE_REVISION: "reviser",
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  TOPIC_PLANNING: "选题分析",
  TOPIC_DISCOVERY: "今日选题搜索",
  RESEARCH: "联网研究",
  VIDEO_WRITING: "视频号",
  XIAOHONGSHU_WRITING: "小红书标题文案",
  XIAOHONGSHU_PAGES_PLANNING: "小红书图文规划",
  IMAGE_GENERATION: "小红书配图",
  WECHAT_WRITING: "公众号大纲（旧版）",
  WECHAT_FULL_ARTICLE: "公众号完整文章（旧版）",
  WECHAT_ARTICLE_WRITING: "公众号文章",
  COMPLIANCE: "合规审核",
  VIDEO_REVISION: "视频号修改",
  XIAOHONGSHU_REVISION: "小红书标题文案修改",
  XIAOHONGSHU_PAGES_REVISION: "小红书图文规划修改",
  WECHAT_ARTICLE_REVISION: "公众号文章修改",
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
  /** Can read an image as input (e.g. reading a reference photo or screenshot). */
  supportsVision: boolean;
  /** Can generate an image as output — required for IMAGE_GENERATION. Unrelated to supportsVision (reading vs. producing an image). */
  supportsImageGeneration: boolean;
  enabled: boolean;
  /** Preferred when AI_DEVELOPMENT_MODE is on and no explicit choice has been made. */
  developmentRecommended: boolean;
  dataPolicyNote: string;
  freeTierNote: string | null;
  pricingNote: string;
  lastVerifiedAt: string;
  /**
   * Fixed reasoning-effort level to request for this model, when it
   * supports one (currently only wired through for OPENAI — see
   * generateOpenAIStructured). Omit for models with no such knob.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
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
