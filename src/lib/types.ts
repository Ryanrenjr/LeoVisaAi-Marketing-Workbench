export type UserRole = "ADMIN" | "EXPERT";

export type TopicStatus =
  | "IDEA"
  | "RESEARCHING"
  | "RESEARCH_READY"
  | "RESEARCH_APPROVED"
  | "CONTENT_DRAFT"
  | "COMPLIANCE_REVIEW"
  | "LEO_REVIEW"
  | "APPROVED"
  | "READY_TO_SHOOT"
  | "PUBLISHED"
  | "ARCHIVED";

export type ContentPillar =
  | "policy_update"
  | "myth_busting"
  | "how_to"
  | "case_study"
  | "news";

export type TopicPriority = "LOW" | "MEDIUM" | "HIGH";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export interface ScoreBreakdown {
  priority: number;
  completeness: number;
}

export interface Topic {
  id: string;
  code: string;
  title: string;
  question: string;
  business: string;
  audience: string;
  content_pillar: ContentPillar | null;
  priority: TopicPriority;
  topic_score: number;
  score_breakdown: ScoreBreakdown;
  status: TopicStatus;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields a person fills in when creating or editing a topic. */
export interface TopicInput {
  title: string;
  question: string;
  business: string;
  audience: string;
  content_pillar: ContentPillar | null;
  priority: TopicPriority;
}

export interface TopicStatusEvent {
  id: string;
  topic_id: string;
  from_status: TopicStatus | null;
  to_status: TopicStatus;
  approved_by: string;
  note: string | null;
  created_at: string;
}

export type TopicActivityType =
  | "topic_created"
  | "topic_edited"
  | "topic_scored"
  | "score_manually_changed"
  | "research_requested"
  | "topic_archived"
  | "research_run_started"
  | "research_run_completed"
  | "research_run_failed"
  | "research_edited"
  | "research_approved"
  | "research_changes_requested"
  | "content_generation_started"
  | "content_generated"
  | "content_generation_failed"
  | "content_regenerated"
  | "content_edited"
  | "full_article_generated"
  | "content_revised"
  | "content_revision_failed";

export interface TopicActivity {
  id: string;
  topic_id: string;
  activity_type: TopicActivityType;
  actor_id: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

// ---------------------------------------------------------------------
// Research Agent
// ---------------------------------------------------------------------

export type ResearchRunStatus = "running" | "completed" | "failed";

export interface ResearchRun {
  id: string;
  topic_id: string;
  status: ResearchRunStatus;
  model_alias: string;
  requested_by: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

export type ResearchConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface ResearchSource {
  id: string;
  research_pack_id: string;
  title: string;
  url: string;
  note: string;
  page_age: string | null;
  created_at: string;
}

export interface ResearchPack {
  id: string;
  research_run_id: string;
  topic_id: string;
  summary: string;
  key_findings: string[];
  warnings: string;
  confidence: ResearchConfidence;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
}

export type ResearchApprovalDecision = "approved" | "changes_requested";

export interface ResearchApproval {
  id: string;
  topic_id: string;
  research_pack_id: string;
  decision: ResearchApprovalDecision;
  decided_by: string;
  note: string | null;
  created_at: string;
}

export interface AiUsageLogEntry {
  id: string;
  workflow_type: string;
  model_alias: string;
  topic_id: string | null;
  platform: ContentPlatform | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  success: boolean;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Content Agent
// ---------------------------------------------------------------------

export type ContentPlatform = "VIDEO_CHANNEL" | "XIAOHONGSHU" | "WECHAT_OFFICIAL_ACCOUNT";

export type ContentType =
  | "video_script"
  | "xiaohongshu_post"
  | "xiaohongshu_pages"
  | "wechat_outline"
  | "wechat_full_article"
  | "wechat_article";

export type ContentAssetStatus = "DRAFT" | "APPROVED" | "ARCHIVED";

export interface ContentAsset {
  id: string;
  topic_id: string;
  research_pack_id: string;
  platform: ContentPlatform;
  content_type: ContentType;
  title: string;
  content: string;
  structured_content: Record<string, unknown>;
  version: number;
  status: ContentAssetStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ComplianceRisk = "LOW" | "MEDIUM" | "HIGH";

export interface ComplianceReviewRow {
  id: string;
  topic_id: string;
  content_asset_id: string;
  overall_risk: ComplianceRisk;
  findings: Array<{ issue_type: string; quote: string; explanation: string }>;
  model_alias: string | null;
  provider: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PublishPerformanceRow {
  id: string;
  topic_id: string;
  platform: ContentPlatform;
  screenshot_path: string;
  extracted_metrics: Record<string, unknown>;
  analysis_note: string;
  model_alias: string | null;
  provider: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ContentImageRow {
  id: string;
  topic_id: string;
  content_asset_id: string | null;
  prompt: string;
  image_path: string;
  model_alias: string | null;
  provider: string | null;
  created_by: string | null;
  created_at: string;
  /** 'generated' = AI image-designer (Xiaohongshu); 'searched' = real Google image result (video/wechat). */
  source: "generated" | "searched";
  search_query: string | null;
  external_source_url: string | null;
  /** 'cover' = a single thumbnail/cover image; 'carousel' = one of a Xiaohongshu post's multi-page images. */
  image_kind: "cover" | "carousel";
  /** Only set for image_kind: 'carousel' — which page (1-based) this image is for. */
  page_index: number | null;
}

/** A real photo of Leo (ADMIN-uploaded) — passed to the image model as a reference when "带特写" is requested, so it can fuse his real likeness into the cover (see generateOpenAIImageEdit in src/lib/ai/providers/openai-provider.ts). Never AI-generated itself. */
export interface LeoPortraitRow {
  id: string;
  image_path: string;
  label: string | null;
  created_by: string | null;
  created_at: string;
}
