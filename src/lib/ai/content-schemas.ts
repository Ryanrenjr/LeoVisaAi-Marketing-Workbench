import { z } from "zod";
import type { ZodType } from "zod";
import type { ResearchConfidence, ResearchSource } from "../types";

/**
 * Pure schema/prompt/grounding logic for the Content Agent — no network
 * calls, no server-only import, so it's directly unit-testable. The
 * orchestration (the actual Anthropic API calls) lives in content-agent.ts.
 * Mirrors the research-pack.ts / research-agent.ts split.
 */

export const EvidenceNoteSchema = z.object({
  claim: z.string(),
  reason: z.enum(["expert_review_required", "research_gap"]),
  note: z.string(),
});
export type EvidenceNote = z.infer<typeof EvidenceNoteSchema>;

export const VideoChannelContentSchema = z.object({
  title: z.string(),
  hook: z.string(),
  cover_text: z.string(),
  target_duration_seconds: z.number().int().min(30).max(180),
  full_script: z.string(),
  evidence_visuals: z.array(z.string()),
  cta: z.string(),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type VideoChannelContent = z.infer<typeof VideoChannelContentSchema>;

export const XiaohongshuContentSchema = z.object({
  title_options: z.array(z.string()).length(3),
  cover_title: z.string(),
  pages: z.array(z.string()).min(6).max(10),
  caption: z.string(),
  keywords: z.array(z.string()),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type XiaohongshuContent = z.infer<typeof XiaohongshuContentSchema>;

export const WechatOutlineSchema = z.object({
  title_options: z.array(z.string()).length(3),
  summary: z.string(),
  detailed_outline: z.array(z.string()),
  key_claims: z.array(z.string()),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type WechatOutline = z.infer<typeof WechatOutlineSchema>;

export const WechatFullArticleSchema = z.object({
  title: z.string(),
  full_article: z.string(),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type WechatFullArticle = z.infer<typeof WechatFullArticleSchema>;

// ---------------------------------------------------------------------
// Source manifest — the model only ever sees short labels ("S1", "S2"),
// never real URLs it could later "invent" a variant of. Labels are
// resolved back to real research_source UUIDs after generation.
// ---------------------------------------------------------------------

export interface SourceManifestEntry {
  label: string;
  source: ResearchSource;
}

export function buildSourceManifest(sources: ResearchSource[]): {
  entries: SourceManifestEntry[];
  labelToId: Map<string, string>;
  manifestText: string;
} {
  const entries = sources.map((source, i) => ({ label: `S${i + 1}`, source }));
  const labelToId = new Map(entries.map((e) => [e.label, e.source.id]));
  const manifestText = entries.length
    ? entries
        .map(
          (e) =>
            `[${e.label}] ${e.source.title} — ${e.source.url}${e.source.note ? ` — ${e.source.note}` : ""}`,
        )
        .join("\n")
    : "（本次研究没有可用的真实来源，内容生成时不得引用任何来源标签）";
  return { entries, labelToId, manifestText };
}

/**
 * The anti-hallucination guarantee for content, mirroring
 * research-pack.ts's groundSources: any label the model uses that wasn't
 * actually in the manifest is dropped, never resolved to a fabricated id.
 */
export function groundContentSources(
  claimedLabels: string[],
  labelToId: Map<string, string>,
): { sourceIds: string[]; droppedCount: number } {
  const sourceIds: string[] = [];
  const seen = new Set<string>();
  let droppedCount = 0;
  for (const raw of claimedLabels) {
    const id = labelToId.get(raw.trim());
    if (id) {
      if (!seen.has(id)) {
        sourceIds.push(id);
        seen.add(id);
      }
    } else {
      droppedCount++;
    }
  }
  return { sourceIds, droppedCount };
}

// ---------------------------------------------------------------------
// Forbidden-phrase safety net — a code-level check, not just a prompt
// request. Detected phrases don't block generation; they get flagged
// into expert_review_notes so a human sees them before publishing.
// ---------------------------------------------------------------------

export const FORBIDDEN_PHRASES: readonly string[] = [
  "英国彻底变天",
  "重磅",
  "赶紧申请",
  "窗口马上关闭",
  "错过就没机会",
];

export function scanForbiddenPhrases(text: string): string[] {
  return FORBIDDEN_PHRASES.filter((phrase) => text.includes(phrase));
}

export function buildForbiddenPhraseNotes(texts: string[]): EvidenceNote[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const phrase of scanForbiddenPhrases(text)) found.add(phrase);
  }
  return Array.from(found).map((phrase) => ({
    claim: phrase,
    reason: "expert_review_required" as const,
    note: `文案中出现了应避免的措辞"${phrase}"，除非研究成果确实支持紧迫性表述，否则请人工确认并调整或删除。`,
  }));
}

export type Groundable = { source_references: string[]; expert_review_notes: EvidenceNote[] };

/**
 * The same source-grounding + forbidden-phrase safety net content-agent.ts
 * applies inline for the Anthropic path, factored out so every other
 * provider's generic structured-content path (see router.ts) gets the
 * identical anti-hallucination guarantee rather than a re-implementation.
 */
export function applyGroundingAndSafety<T extends Groundable>(
  parsed: T,
  labelToId: Map<string, string>,
  textFieldsForScan: (parsed: T) => string[],
): T {
  const { sourceIds, droppedCount } = groundContentSources(parsed.source_references, labelToId);
  const droppedNote: EvidenceNote[] =
    droppedCount > 0
      ? [
          {
            claim: "来源引用",
            reason: "expert_review_required",
            note: `已自动移除 ${droppedCount} 条未在验证来源中找到的引用标签。`,
          },
        ]
      : [];
  const forbiddenNotes = buildForbiddenPhraseNotes(textFieldsForScan(parsed));

  return {
    ...parsed,
    source_references: sourceIds,
    expert_review_notes: [...parsed.expert_review_notes, ...droppedNote, ...forbiddenNotes],
  };
}

// ---------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------

export const CONTENT_AGENT_SHARED_RULES = `You are writing marketing content for LeoVisaAi, a UK immigration services content team, under the "Leo" persona: experienced, restrained, calm, practical, evidence-based, professional. Not influencer-like. Not alarmist. Do NOT open with "大家好，我是李尔王。" or any other fixed greeting formula.

Evidence boundary — this is the most important rule. The approved Research Pack given to you below is your ONLY evidence base for immigration rules, policy details, deadlines, or numbers. Distinguish three kinds of content as you write:
A. Claims directly supported by the Research Pack — state these as grounded conclusions.
B. Editorial framing, explanation, or transitions — fine to write freely; this is not a factual claim about immigration rules.
C. Something that would make the content more useful but is NOT covered by the Research Pack — do NOT invent or assert it. Instead add an entry to expert_review_notes: reason "research_gap" if the research simply doesn't cover it, or "expert_review_required" if a human immigration expert should confirm it before publishing.

Never state a new immigration rule, policy detail, deadline, or number that isn't traceable to the Research Pack above.

When you rely on a specific source, reference it by its exact label from the manifest below (e.g. "S1") in source_references. Never invent a source, a URL, or reference a label that isn't in the manifest.

Avoid fear-based or hype language such as "英国彻底变天" / "重磅" / "赶紧申请" / "窗口马上关闭" / "错过就没机会" or similar, unless the approved Research Pack genuinely supports urgent timing (e.g. an actual stated deadline).

Output only the structured content requested — no extra commentary outside the schema.`;

export const VIDEO_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are writing a script for a VIDEO_CHANNEL (视频号) short video, target 60–120 seconds, following this structure:
- 0–5 seconds: the actual user problem / conflict
- 5–25 seconds: give the conclusion first
- 25–60 seconds: explain the rule or framework (grounded in the Research Pack)
- 60–90 seconds: exception / real-world nuance / practitioner judgment
- ending: note who may need further professional assessment

full_script is the complete spoken narration following this structure. evidence_visuals are short practical suggestions for what to show on screen at each beat — not a timecoded shot list.`;

export const XHS_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are writing content for Xiaohongshu (小红书). This must be independently adapted for that platform's behavior — do NOT simply convert a video script into page breaks. Prioritize: search intent, saveability, checklists, decision frameworks, scenario comparison, timelines, and common misunderstandings. Produce 6–10 pages, each page a self-contained chunk of text suitable for one image card.`;

export const WECHAT_OUTLINE_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are producing an OUTLINE for a WeChat Official Account (公众号) article — not the full article. detailed_outline is a section-by-section outline (not full prose). key_claims lists the substantive claims the eventual article will make, each traceable to the Research Pack. faq anticipates 3-6 likely reader questions with brief, grounded answers.`;

export const WECHAT_FULL_ARTICLE_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are expanding an already-approved outline into a full WeChat Official Account article. Follow the outline's structure and key claims — do not introduce claims beyond what the outline and Research Pack support. Write complete, natural prose suitable for publication (still subject to human review before it goes out).`;

export function buildEvidenceContextBlock(
  topic: {
    title: string;
    question: string;
    business: string;
    audience: string;
    content_pillar: string | null;
  },
  researchPack: {
    summary: string;
    key_findings: string[];
    warnings: string;
    confidence: ResearchConfidence;
  },
  manifestText: string,
): string {
  const lines = [
    `选题标题：${topic.title}`,
    topic.question ? `选题问题：${topic.question}` : null,
    topic.business ? `业务线：${topic.business}` : null,
    topic.audience ? `目标受众：${topic.audience}` : null,
    topic.content_pillar ? `内容支柱：${topic.content_pillar}` : null,
    "",
    "=== 已批准的研究成果（唯一证据来源）===",
    `研究摘要：${researchPack.summary}`,
    researchPack.key_findings.length > 0
      ? `关键发现：\n${researchPack.key_findings.map((f) => `- ${f}`).join("\n")}`
      : null,
    researchPack.warnings ? `研究注意事项：${researchPack.warnings}` : null,
    `研究置信度：${researchPack.confidence}`,
    "",
    "=== 可引用的真实来源（仅可使用以下标签，不得编造新来源或URL）===",
    manifestText,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

export function buildOutlineContextBlock(outline: {
  title_options: string[];
  summary: string;
  detailed_outline: string[];
  key_claims: string[];
}): string {
  return [
    "=== 已生成的公众号大纲（完整文章须遵循此结构与主张）===",
    `候选标题：${outline.title_options.join(" / ")}`,
    `摘要：${outline.summary}`,
    `大纲：\n${outline.detailed_outline.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    `关键主张：\n${outline.key_claims.map((c) => `- ${c}`).join("\n")}`,
  ].join("\n");
}

// ---------------------------------------------------------------------
// Task config for the generic multi-provider content path (router.ts).
// Mirrors the per-platform config content-agent.ts builds inline for its
// Anthropic-specific calls — kept as a separate, explicit map here so a
// non-Anthropic provider never needs to guess a prompt/schema pairing.
// ---------------------------------------------------------------------

export interface ContentTaskConfig<T extends Groundable> {
  systemPrompt: string;
  taskInstruction: string;
  schema: ZodType<T>;
  maxTokens: number;
  textFieldsForScan: (parsed: T) => string[];
}

export const CONTENT_TASK_CONFIG = {
  VIDEO_WRITING: {
    systemPrompt: VIDEO_SYSTEM_PROMPT,
    taskInstruction: "Write the VIDEO_CHANNEL script now, following the structure and rules above.",
    schema: VideoChannelContentSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: VideoChannelContent) => [c.title, c.hook, c.cover_text, c.full_script, c.cta],
  } satisfies ContentTaskConfig<VideoChannelContent>,
  XIAOHONGSHU_WRITING: {
    systemPrompt: XHS_SYSTEM_PROMPT,
    taskInstruction: "Write the Xiaohongshu content now, following the structure and rules above.",
    schema: XiaohongshuContentSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: XiaohongshuContent) => [...c.title_options, c.cover_title, ...c.pages, c.caption],
  } satisfies ContentTaskConfig<XiaohongshuContent>,
  WECHAT_WRITING: {
    systemPrompt: WECHAT_OUTLINE_SYSTEM_PROMPT,
    taskInstruction:
      "Write the WeChat Official Account OUTLINE now (not the full article), following the rules above.",
    schema: WechatOutlineSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: WechatOutline) => [...c.title_options, c.summary, ...c.detailed_outline, ...c.key_claims],
  } satisfies ContentTaskConfig<WechatOutline>,
} as const;

export type GenericContentTaskType = keyof typeof CONTENT_TASK_CONFIG;
