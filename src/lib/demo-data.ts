import { computeTopicScore } from "./scoring";
import type {
  AiUsageLogEntry,
  ContentAsset,
  Profile,
  ResearchPack,
  ResearchSource,
  Topic,
  TopicActivity,
  TopicStatusEvent,
} from "./types";

/**
 * Static fallback content, used only when Supabase isn't configured yet
 * (no .env.local) or a query fails. See docs/architecture.md
 * "Demo-data fallback". Never used once real credentials are set and the
 * database is reachable.
 */

const now = Date.now();
const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

type SeedTopic = Pick<
  Topic,
  "id" | "code" | "title" | "question" | "business" | "audience" | "content_pillar" | "priority" | "status"
> & { created_at: string; updated_at: string; published_at: string | null };

const LIBRARY_SEED: SeedTopic[] = [
  {
    id: "demo-t1",
    code: "T-0001",
    title: "老永居离境超过2年，身份还在吗？",
    question: "老永居离境超过2年，身份还在吗？",
    business: "永居 / ILR",
    audience: "持老式永居（ILR）并长期离境的申请人",
    content_pillar: "myth_busting",
    priority: "HIGH",
    status: "IDEA",
    created_at: days(1),
    updated_at: days(1),
    published_at: null,
  },
  {
    id: "demo-t2",
    code: "T-0002",
    title: "工签被裁员后还有多少时间？",
    question: "工签被裁员后还有多少时间？",
    business: "工作签证 / Skilled Worker",
    audience: "被担保雇主裁员的工签持有人",
    content_pillar: "how_to",
    priority: "HIGH",
    status: "IDEA",
    created_at: days(2),
    updated_at: days(2),
    published_at: null,
  },
  {
    id: "demo-t3",
    code: "T-0003",
    title: "英国出生的小孩自动是英国籍吗？",
    question: "英国出生的小孩自动是英国籍吗？",
    business: "国籍 / British Citizenship",
    audience: "在英生育或计划生育的父母",
    content_pillar: "myth_busting",
    priority: "MEDIUM",
    status: "IDEA",
    created_at: days(3),
    updated_at: days(3),
    published_at: null,
  },
  {
    id: "demo-t4",
    code: "T-0004",
    title: "老永居换eVisa前，先查这3件事",
    question: "老永居换eVisa前，先查这3件事",
    business: "eVisa",
    audience: "持老式永居、尚未换领 eVisa 的申请人",
    content_pillar: "how_to",
    priority: "HIGH",
    status: "RESEARCH_READY",
    created_at: days(5),
    updated_at: days(4),
    published_at: null,
  },
  {
    id: "demo-t5",
    code: "T-0005",
    title: "10年永居中间断过一次怎么办？",
    question: "10年永居中间断过一次怎么办？",
    business: "永居 / Long Residence",
    audience: "走10年长期居留路径、有离境记录的申请人",
    content_pillar: "myth_busting",
    priority: "MEDIUM",
    status: "RESEARCH_READY",
    created_at: days(6),
    updated_at: days(5),
    published_at: null,
  },
  {
    id: "demo-t6",
    code: "T-0006",
    title: "Sponsor Licence真正容易出问题的环节",
    question: "Sponsor Licence真正容易出问题的环节",
    business: "担保牌照 / Sponsor Licence",
    audience: "持有或申请担保牌照的雇主",
    content_pillar: "case_study",
    priority: "MEDIUM",
    status: "IDEA",
    created_at: days(1),
    updated_at: days(1),
    published_at: null,
  },
];

const PIPELINE_SEED: SeedTopic[] = [
  {
    id: "demo-p1",
    code: "T-0007",
    title: "打工度假签证误区盘点",
    question: "打工度假签证有哪些常见误区？",
    business: "",
    audience: "",
    content_pillar: null,
    priority: "MEDIUM",
    status: "RESEARCH_APPROVED",
    created_at: days(8),
    updated_at: days(6),
    published_at: null,
  },
  {
    id: "demo-p2",
    code: "T-0008",
    title: "雇主担保签证案例解读",
    question: "雇主担保签证成功案例有哪些经验？",
    business: "",
    audience: "",
    content_pillar: null,
    priority: "MEDIUM",
    status: "READY_TO_SHOOT",
    created_at: days(9),
    updated_at: days(3),
    published_at: null,
  },
  {
    id: "demo-p3",
    code: "T-0009",
    title: "技术移民打分变化解读",
    question: "本季度技术移民打分政策有什么变化？",
    business: "",
    audience: "",
    content_pillar: null,
    priority: "HIGH",
    status: "PUBLISHED",
    created_at: days(12),
    updated_at: days(2),
    published_at: days(2),
  },
  {
    id: "demo-p4",
    code: "T-0010",
    title: "留学转技术移民路径图",
    question: "留学生转技术移民有哪些常见路径？",
    business: "",
    audience: "",
    content_pillar: null,
    priority: "LOW",
    status: "PUBLISHED",
    created_at: days(20),
    updated_at: days(10),
    published_at: days(10),
  },
  {
    id: "demo-p5",
    code: "T-0011",
    title: "留学生打工时长规定详解",
    question: "留学生每周打工时长上限是多少？",
    business: "留学 / Student Visa",
    audience: "在英留学并计划打工的学生",
    content_pillar: "how_to",
    priority: "MEDIUM",
    status: "CONTENT_DRAFT",
    created_at: days(6),
    updated_at: days(1),
    published_at: null,
  },
];

function toTopic(seed: SeedTopic): Topic {
  const { total, breakdown } = computeTopicScore(seed);
  return { ...seed, topic_score: total, score_breakdown: breakdown, created_by: null };
}

export const DEMO_TOPICS: Topic[] = [...LIBRARY_SEED, ...PIPELINE_SEED].map(toTopic);

export const DEMO_PROFILES: Profile[] = [
  {
    id: "demo-admin",
    email: "admin@example.com",
    display_name: "演示管理员",
    role: "ADMIN",
    created_at: days(30),
  },
  {
    id: "demo-expert",
    email: "expert@example.com",
    display_name: "演示专员",
    role: "EXPERT",
    created_at: days(20),
  },
];

export const DEMO_STATUS_EVENTS: TopicStatusEvent[] = [
  {
    id: "demo-event-1",
    topic_id: "demo-p3",
    from_status: "READY_TO_SHOOT",
    to_status: "PUBLISHED",
    approved_by: "demo-admin",
    note: null,
    created_at: days(2),
  },
];

export const DEMO_ACTIVITY: TopicActivity[] = [
  {
    id: "demo-activity-1",
    topic_id: "demo-t1",
    activity_type: "topic_created",
    actor_id: "demo-expert",
    detail: null,
    created_at: days(1),
  },
  {
    id: "demo-activity-2",
    topic_id: "demo-t4",
    activity_type: "topic_created",
    actor_id: "demo-expert",
    detail: null,
    created_at: days(5),
  },
  {
    id: "demo-activity-3",
    topic_id: "demo-t4",
    activity_type: "research_requested",
    actor_id: "demo-admin",
    detail: null,
    created_at: days(4),
  },
  {
    id: "demo-activity-4",
    topic_id: "demo-t4",
    activity_type: "research_run_started",
    actor_id: "demo-admin",
    detail: null,
    created_at: days(3),
  },
  {
    id: "demo-activity-5",
    topic_id: "demo-t4",
    activity_type: "research_run_completed",
    actor_id: "demo-admin",
    detail: null,
    created_at: days(3),
  },
  {
    id: "demo-activity-6",
    topic_id: "demo-p5",
    activity_type: "content_generation_started",
    actor_id: "demo-admin",
    detail: null,
    created_at: days(1),
  },
  {
    id: "demo-activity-7",
    topic_id: "demo-p5",
    activity_type: "content_generated",
    actor_id: "demo-admin",
    detail: { platform: "VIDEO_CHANNEL", version: 1 },
    created_at: days(1),
  },
  {
    id: "demo-activity-8",
    topic_id: "demo-p5",
    activity_type: "content_generated",
    actor_id: "demo-admin",
    detail: { platform: "XIAOHONGSHU", version: 1 },
    created_at: days(1),
  },
  {
    id: "demo-activity-9",
    topic_id: "demo-p5",
    activity_type: "content_generation_failed",
    actor_id: "demo-admin",
    detail: { platform: "WECHAT_OFFICIAL_ACCOUNT", error: "（示例）演示：模拟公众号大纲生成失败，可点击重试。" },
    created_at: days(1),
  },
];

/**
 * Demo research pack — placeholder content, not a real web-search result.
 * See docs/phase-3-plan.md "Demo-mode research pack" — this exists only
 * so the Research Pack UI has something to preview before a real
 * ANTHROPIC_API_KEY is connected.
 */
export const DEMO_RESEARCH_PACKS: ResearchPack[] = [
  {
    id: "demo-pack-1",
    research_run_id: "demo-run-1",
    topic_id: "demo-t4",
    summary:
      "（示例）英国内政部已逐步以 eVisa 取代实体/生物识别居留卡（BRP），老永居持有人需在规定时间内完成账号关联，否则可能影响出行与身份核验。",
    key_findings: [
      "示例发现：官方过渡时间表分阶段推进，不同证件类型的截止日期不同",
      "示例发现：账号关联需要护照或旅行证件信息，若证件已过期需先更新",
      "示例发现：出行前建议保留旧证件与 eVisa 关联凭证的双重证明",
    ],
    warnings: "（示例）以下来源与摘要为占位演示数据，非真实网络搜索结果；请在正式使用前通过“运行研究”生成真实来源。",
    confidence: "MEDIUM",
    edited_by: null,
    edited_at: null,
    created_at: days(3),
  },
  {
    id: "demo-pack-2",
    research_run_id: "demo-run-2",
    topic_id: "demo-t5",
    summary:
      "（示例）关于10年长期居留期间中断一次的具体宽限规则，公开来源信息较少且表述不一致，建议人工进一步核实官方最新指引后再决定是否采用。",
    key_findings: ["示例发现：不同来源对“单次中断的可接受时长”表述不一致，需以官方指引为准"],
    warnings: "（示例）本次演示数据模拟“来源薄弱、置信度低”的情况，用于预览低置信度提示样式，非真实搜索结果。",
    confidence: "LOW",
    edited_by: null,
    edited_at: null,
    created_at: days(4),
  },
  {
    id: "demo-pack-3",
    research_run_id: "demo-run-3",
    topic_id: "demo-p5",
    summary: "（示例）留学生 Tier 4/Student 签证持有人在学期内每周打工时长上限为20小时，假期内可全职工作，具体以院校课程等级与签证条件为准。",
    key_findings: [
      "示例发现：学期内每周打工时长上限通常为20小时（以官方最新指引为准）",
      "示例发现：官方假期内不受该上限约束，但仍需符合签证其他条件",
    ],
    warnings: "（示例）以下内容与来源为占位演示数据，非真实网络搜索结果。",
    confidence: "HIGH",
    edited_by: null,
    edited_at: null,
    created_at: days(2),
  },
];

export const DEMO_RESEARCH_SOURCES: ResearchSource[] = [
  {
    id: "demo-source-1",
    research_pack_id: "demo-pack-1",
    title: "示例来源：GOV.UK — eVisa 说明（占位）",
    url: "https://www.gov.uk/example-evisa",
    note: "示例摘要：官方 eVisa 概览与过渡时间表（占位内容，非真实抓取）。",
    page_age: "3 个月前更新（占位）",
    created_at: days(3),
  },
  {
    id: "demo-source-2",
    research_pack_id: "demo-pack-1",
    title: "示例来源：UKVI 账号关联指引（占位）",
    url: "https://www.gov.uk/example-evisa-account",
    note: "示例摘要：如何将旧证件关联到 UKVI 账号（占位内容，非真实抓取）。",
    page_age: null,
    created_at: days(3),
  },
  {
    id: "demo-source-3",
    research_pack_id: "demo-pack-3",
    title: "示例来源：GOV.UK — 学生签证打工规定（占位）",
    url: "https://www.gov.uk/example-student-visa-work",
    note: "示例摘要：学生签证打工时长与条件官方说明（占位内容，非真实抓取）。",
    page_age: "1 个月前更新（占位）",
    created_at: days(2),
  },
];

export const DEMO_AI_USAGE_LOG: AiUsageLogEntry[] = [
  {
    id: "demo-usage-1",
    workflow_type: "research",
    model_alias: "claude-opus-5",
    topic_id: "demo-t4",
    platform: null,
    input_tokens: 4200,
    output_tokens: 950,
    latency_ms: 18400,
    success: true,
    error: null,
    created_at: days(3),
  },
  {
    id: "demo-usage-2",
    workflow_type: "content",
    model_alias: "claude-opus-5",
    topic_id: "demo-p5",
    platform: "VIDEO_CHANNEL",
    input_tokens: 2100,
    output_tokens: 1400,
    latency_ms: 9800,
    success: true,
    error: null,
    created_at: days(1),
  },
  {
    id: "demo-usage-3",
    workflow_type: "content",
    model_alias: "claude-opus-5",
    topic_id: "demo-p5",
    platform: "XIAOHONGSHU",
    input_tokens: 2050,
    output_tokens: 1100,
    latency_ms: 8600,
    success: true,
    error: null,
    created_at: days(1),
  },
];

/**
 * Demo content assets — placeholder AI-generated drafts, not real output.
 * Shows the tabs UI (视频号/小红书) with content already generated;
 * 公众号 is left empty on purpose to also preview the "not yet generated"
 * state. See docs/phase-4-plan.md.
 */
export const DEMO_CONTENT_ASSETS: ContentAsset[] = [
  {
    id: "demo-content-1",
    topic_id: "demo-p5",
    research_pack_id: "demo-pack-3",
    platform: "VIDEO_CHANNEL",
    content_type: "video_script",
    title: "（示例）留学生打工超过20小时会怎样？",
    content: "（示例口播稿）很多同学以为打工超时只是扣点钱……",
    structured_content: {
      title: "（示例）留学生打工超过20小时会怎样？",
      hook: "（示例）你以为打工超时只是少拿点工资？",
      cover_text: "打工超时的真实后果",
      target_duration_seconds: 75,
      full_script:
        "（示例口播稿，非真实生成内容）很多同学以为学期内打工超过每周20小时上限只是小事……先说结论：这是签证条件的一部分，不是单纯的劳动问题。学期内的每周20小时上限来自签证条件本身，官方假期不受此限制……具体到你的课程等级和签证类型可能有差异，建议在安排工作前跟学校国际学生办公室或专业人士确认清楚。",
      evidence_visuals: ["示例：签证条件截图示意", "示例：学期与假期时间轴示意图"],
      cta: "（示例）不确定自己的上限？评论区留言你的签证类型。",
      source_references: ["demo-source-3"],
      expert_review_notes: [],
    },
    version: 1,
    status: "DRAFT",
    created_by: "demo-admin",
    created_at: days(1),
    updated_at: days(1),
  },
  {
    id: "demo-content-2",
    topic_id: "demo-p5",
    research_pack_id: "demo-pack-3",
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_post",
    title: "（示例）留学生打工时长速查表",
    content: "（示例正文）学期内 vs 假期，打工时长到底怎么算？",
    structured_content: {
      title_options: ["（示例）留学生打工时长速查表", "（示例）打工超时会怎样？", "（示例）学期vs假期打工规则"],
      cover_title: "打工时长速查表",
      pages: [
        "（示例）P1 封面：学期内 vs 假期，打工时长怎么算？",
        "（示例）P2 结论先行：学期内每周上限20小时",
        "（示例）P3 官方假期不受此上限约束",
        "（示例）P4 常见误区：以为按月平均就行",
        "（示例）P5 检查清单：确认课程等级、签证类型、学校日历",
        "（示例）P6 建议：安排工作前找学校国际学生办公室确认",
      ],
      caption: "（示例）打工时长算错了不只是扣钱这么简单，几个关键点一次说清楚～",
      keywords: ["留学生打工", "学生签证", "打工时长"],
      source_references: ["demo-source-3"],
      expert_review_notes: [
        {
          claim: "不同课程等级的具体上限差异",
          reason: "research_gap",
          note: "（示例）研究成果未覆盖各课程等级的差异细节，发布前建议人工补充确认。",
        },
      ],
    },
    version: 1,
    status: "DRAFT",
    created_by: "demo-admin",
    created_at: days(1),
    updated_at: days(1),
  },
];
