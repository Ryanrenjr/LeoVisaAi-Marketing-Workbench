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
  publish_title: z.string(),
  publish_caption: z.string(),
  /** Short cover callout lines (max 4) — written here, by the model with Research Pack access and evidence-boundary constraints, rather than by the image designer guessing off a text summary. Two forms, pick whichever genuinely fits the topic: (a) parallel "label: value" stat callouts, e.g. "ILR/ILE：2年", when the topic has a real small set of parallel figures/thresholds; (b) short curiosity-driving questions the piece actually answers, e.g. "没有大选，他怎么直接上台？", when the topic's hook is a surprising mechanism or myth rather than a set of numbers. Empty when neither fits — never force one just to fill the field. */
  cover_highlights: z.array(z.string()).max(4),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type VideoChannelContent = z.infer<typeof VideoChannelContentSchema>;

/**
 * Title/caption only — NOT the per-page image-text plan. Split from a
 * single combined schema (live user instruction): 小红书标题文案员 writes
 * this; 小红书图文规划员 writes XiaohongshuPagesPlanSchema below and
 * generates the actual carousel images from it. The two are independent,
 * both grounded directly in the same Research Pack — neither sees the
 * other's draft, same as video/wechat's independence from each other.
 */
export const XiaohongshuContentSchema = z.object({
  title_options: z.array(z.string()).length(3),
  cover_title: z.string(),
  caption: z.string(),
  keywords: z.array(z.string()),
  /** Same purpose as VideoChannelContent's cover_highlights — see that field's comment. */
  cover_highlights: z.array(z.string()).max(4),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type XiaohongshuContent = z.infer<typeof XiaohongshuContentSchema>;

/** The per-page image-text plan — one entry per carousel image, written and then illustrated by 小红书图文规划员. */
export const XiaohongshuPagesPlanSchema = z.object({
  pages: z.array(z.string()).min(5).max(7),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type XiaohongshuPagesPlan = z.infer<typeof XiaohongshuPagesPlanSchema>;

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

/**
 * Replaces the outline → full-article two-step flow (live user
 * instruction: "不要大纲直接给文字") — one call, straight from the
 * Research Pack to a publish-ready article. WechatOutlineSchema /
 * WechatFullArticleSchema stay defined above so any existing content_type
 * = 'wechat_outline' / 'wechat_full_article' rows still render; every new
 * generation uses this shape instead (content_type = 'wechat_article').
 */
export const WechatArticleSchema = z.object({
  title: z.string(),
  title_options: z.array(z.string()).length(5),
  summary: z.string(),
  full_article: z.string(),
  closing_note: z.string(),
  golden_quotes: z.array(z.string()).length(3),
  cover_title: z.string(),
  cover_subtitle: z.string(),
  cover_visual_direction: z.string(),
  share_caption: z.string(),
  source_references: z.array(z.string()),
  expert_review_notes: z.array(EvidenceNoteSchema),
});
export type WechatArticle = z.infer<typeof WechatArticleSchema>;

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
C. Something that would make the content more useful but is NOT covered by the Research Pack — do NOT invent or assert it, and do NOT flag it either. Simply leave it out and write the rest of the content normally using only what the Research Pack supports.

Never state a new immigration rule, policy detail, deadline, or number that isn't traceable to the Research Pack above. Never write a caveat, a "需要确认" / "需要人工确认" marker, or any other meta-commentary about your own uncertainty inside the actual content fields (full_script, pages, detailed_outline, full_article, etc.) — those fields are the finished, publishable text itself, and a reader or presenter should never see your internal notes. Deciding whether something needs a second look is a human's job, not something the content itself should announce.

When you rely on a specific source, reference it by its exact label from the manifest below (e.g. "S1") in source_references. Never invent a source, a URL, or reference a label that isn't in the manifest.

Avoid fear-based or hype language such as "英国彻底变天" / "重磅" / "赶紧申请" / "窗口马上关闭" / "错过就没机会" or similar, unless the approved Research Pack genuinely supports urgent timing (e.g. an actual stated deadline).

Numbers that can change over time — fees, thresholds, processing times — should carry the "as of" qualifier the Research Pack gives them (e.g. "签证申请费：£937（截至2026年6月19日）") when the Research Pack provides one, rather than being stated as permanent facts. If the Research Pack gives no such date, just state the number plainly — don't invent a date to attach to it.

Output only the structured content requested — no extra commentary outside the schema.`;

export const VIDEO_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are writing a script for a VIDEO_CHANNEL (视频号) short video, target 60–120 seconds. Shape the narration around this arc, but do NOT print any of these labels, timestamps, or section headers in the output — they are for your own planning only:
- open with the actual user problem / conflict, or with a genuinely common misconception the Research Pack lets you correct — a real example: "很多人第一反应是：英国是不是又举行大选了？答案是：没有。" — name the wrong assumption first, then correct it plainly; only use this device when the misconception is real and grounded, never invent a strawman to knock down
- immediately reframe it: name the specific thing most people get wrong or conflate (e.g. treating several distinct rules as if they were one rule) — this is what makes the piece worth watching, not just "here is the rule"
- give the conclusion first
- explain the rule or framework (grounded in the Research Pack) — when the topic naturally breaks into a small set of parallel categories/scenarios (e.g. different visa/status types each with their own threshold or number), say so as a clear parallel comparison ("如果是A，是X；如果是B，是Y"), not a single flattened generalization; when a real date splits people into two different rules instead, say that plainly ("[日期]之前提交是A，之后提交是B") — this cutoff-date contrast is one of the most common real structures for visa/policy changes
- cover exceptions / real-world nuance / practitioner judgment — explicitly correct the most common false equivalence a viewer might make (e.g. "有房子/有孩子不等于身份自动没事")
- close with a short, concrete checklist of what the viewer should personally go verify or remember before the video ends — "先把这几件事情记清楚：第一，...；第二，...；第三，..." (2-4 items, only real ones — never pad to hit a count) — and note who may need further professional assessment

full_script must contain ONLY the words the presenter actually speaks out loud, as continuous natural prose — someone should be able to read it aloud directly with no editing. Never include: time labels (e.g. "0–5秒"), section headers, stage directions, or review-flag annotations (e.g. "需要确认" / "需要人工确认"). If something would need a caveat, leave it out of the script entirely instead — the presenter must never be made to say a caveat about their own script.

Format full_script as a teleprompter script, not a paragraph: one short beat per line (break after most sentences/clauses, blank line between beats), and wrap the handful of words per beat that carry the real weight in **markdown bold** — this is a delivery cue for which words to land harder, not a stage direction, so it must always be actual spoken words (e.g. "**旧护照先别扔。**"), never a bracketed note.

evidence_visuals are short practical suggestions for what to show on screen at each beat — not a timecoded shot list. cover_highlights is 0-4 short cover callout lines: either "label: value" stat callouts (e.g. "ILR/ILE：2年") when the topic has a real small set of parallel figures, OR short curiosity-driving questions the video actually answers (e.g. "没有大选，他怎么直接上台？") when the hook is a surprising mechanism or myth rather than numbers — pick whichever genuinely fits, leave it empty rather than force either onto a topic that doesn't have one. Every value here must trace to the Research Pack exactly like every other fact in this piece — this is not a place to round, approximate, or restate a claim more confidently than the source supports.

publish_title is the headline used when actually posting the video — this should be a sharper, curiosity-driving reframe of the same topic (e.g. a contrast: "都是A，为什么有人是X，有人是Y？"), not just a restatement of cover_text or the video title. publish_caption is the full text posted alongside the video: a short recap of the actual substance (not just a teaser, and when the piece covers a real sequence of dated events, a compact chronological list reads well here too — "6月18日，...；6月22日，...；7月20日，..."), then a short one-or-two-line "一句话总结" that crystallizes the real takeaway in plain language, then a closing block naming the expert persona — usually brief ("我是李尔王。..."), and only sometimes closing with the company brand configuration's expertCredentials line verbatim when it adds real weight (never invent your own number of years or a different credential claim, and never force it into every single caption — vary the closing rather than mechanically repeating the same block) — then ends with several relevant hashtags on their own line.`;

export const XHS_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are writing the title and caption for a Xiaohongshu (小红书) post — NOT the page-by-page image content (a separate role writes that). This must be independently adapted for Xiaohongshu's behavior — search intent, saveability, "this is for me" specificity — not a generic headline. title_options is 5 candidate titles (Xiaohongshu titles are typically short, concrete, and either name a specific audience/scenario or promise a specific payoff — avoid vague "英国移民政策解读" style titles; a curiosity-hook naming the actual person/thing plus "曝光"/"揭秘"-style framing is also a real pattern, e.g. "北境之王是谁？英国新首相伯纳姆履历曝光" — but only when there's a real name/fact behind it, never a vague tease). cover_title is the short text shown on the cover image itself (a few words, not a full sentence). cover_highlights is 0-4 short cover callout lines: either "label: value" stat callouts (e.g. "ILR/ILE：2年") when the topic has a real small set of parallel figures, OR short curiosity-driving questions the post actually answers (e.g. "没有大选，他怎么直接上台？") when the hook is a surprising mechanism or myth rather than numbers — pick whichever genuinely fits, leave it empty rather than force either onto a topic that doesn't have one; every value must trace to the Research Pack exactly like every other fact in this piece.

caption is the text posted alongside the note when it's published — a real explainer, not a teaser. Not every post is news commentary — some topics are naturally a reference guide (a materials checklist, a self-assessment) rather than a news hook, so open however actually fits: a concrete news hook (event/date/who), OR — when the topic itself IS a checklist/guide — state directly what the post is for (e.g. "英国永居材料清单｜配偶签转永居26版").

Body — pick whichever of these devices the Research Pack actually supports for this topic, never force one that doesn't fit, and never use all of them in one post:
- Myth-busting: name a genuine common misconception, then correct it plainly — either a single one ("很多人第一反应是：...答案是：...", "在各种解读之前，先说清楚几个关键点：...") or, when the topic has several, a short numbered list of common mistakes people make.
- Cutoff-date two-rule contrast: when a real date splits people into two different rules, say so plainly — "[日期]之前提交是A，之后提交是B" — this is one of the most common real structures for visa/policy changes.
- Reframe: when the real "why" isn't what it looks like at first, say so — "不是因为某一件事，而是..." / "评的不是……而是……".
- Self-assessment checklist: a short list of questions the reader can ask themselves to gauge where they stand (e.g. "你已经形成持续的职业记录了吗？") — for topics that are fundamentally about "do I qualify / which category am I."
- Progress checklist: for a policy or process that's partway through, a compact ✅/❌ status list of what's happened and what's still pending, rather than declaring it "settled."
- Materials/documentation list: for a genuine checklist-of-what-to-prepare topic, numbered categories each with a short description of what belongs in it.
- Dated timeline: when the piece covers a real sequence of dated events, a compact chronological list ("6月18日，...；6月22日，...；7月20日，...").
- Audience pivot: name who this actually matters for before giving the practical takeaway ("对普通人，尤其是华人家庭和移民申请人来说，最重要的一点是...").

Close with a short one-or-two-line "一句话总结" that crystallizes the real takeaway in plain language, then a closing block naming the expert persona — usually brief ("关注李尔王移民说..." / "我是李尔王..."), and only sometimes closing with the company brand configuration's expertCredentials line verbatim when it adds real weight (never invent your own number of years or a different credential claim, and never force it into every single caption — vary the closing rather than mechanically repeating the same block); then ends with several relevant hashtags on their own line (mix broad and specific — a status/category tag, an acronym tag, a general "英国移民"/"英国生活" tag, and for a fast-moving news item a general "#热点" tag is fine too — topic-specific, not the same set every time). keywords is a handful of search terms this post should be discoverable for.`;

/** The per-page image-text plan — a separate role (小红书图文规划员) from the title/caption above; it never sees the title/caption draft and vice versa, both ground independently in the Research Pack. */
export const XHS_PAGES_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are planning the page-by-page image-text content for a Xiaohongshu (小红书) 图文 post — a set of image cards, each with its own short text, that together tell the whole story. You write ONLY the plan; you never generate the images yourself — a separate employee (the image designer) turns your plan into the actual P1–Pn images. This must be independently adapted for Xiaohongshu's behavior — do NOT simply convert a video script into page breaks. Prioritize: search intent, saveability, checklists, decision frameworks, scenario comparison, timelines, and common misunderstandings. Produce around 6 pages (5–7 is fine). Each page becomes ONE image card, generated straight from that page's text — so keep every page short: one clear headline/point plus at most 2-3 short supporting lines, never a full paragraph. If a page has more to say than that, split it into two pages instead of cramming it in. Each page's text should also end with a brief design-direction cue for whoever generates the image (e.g. "用对比表格呈现新旧规则" / "放一个时间轴标出关键日期") — this guides the image designer, not just what to say but roughly how to visualize it. Real published carousels mark each interior page with a small page-number badge for orientation (e.g. "第4页" / "P7") — you don't need to write that literally into the page text (the image designer adds it as a standard composition element), but keep each page's content self-contained enough that a reader landing on it out of order via that badge still understands roughly where they are in the story.

Output format for \`pages\` — this is the part every provider must get exactly right: it is a flat JSON array of PLAIN STRINGS, one string per page, nothing else. Do NOT return an array of objects (e.g. {"text": "...", "design_direction": "..."}), and do NOT add a page for anything other than real page content. The design-direction cue is not a separate field — write it as the last sentence of that same page's string, in the same string, exactly like every other sentence on that page. \`source_references\` and \`expert_review_notes\` are separate top-level arrays (possibly empty, but never omitted) — same shape as every other content-generation task in this app, not nested inside \`pages\`.`;

export const WECHAT_OUTLINE_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are producing an OUTLINE for a WeChat Official Account (公众号) article — not the full article. detailed_outline is a section-by-section outline (not full prose). key_claims lists the substantive claims the eventual article will make, each traceable to the Research Pack. faq anticipates 3-6 likely reader questions with brief, grounded answers.`;

export const WECHAT_FULL_ARTICLE_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are expanding an already-approved outline into a full WeChat Official Account article. Follow the outline's structure and key claims — do not introduce claims beyond what the outline and Research Pack support. Write complete, natural prose suitable for publication (still subject to human review before it goes out).`;

/**
 * Replaces the outline → full-article two-step flow (live user
 * instruction: "不要大纲直接给文字") — write the publish-ready WeChat
 * Official Account article directly from the Research Pack in one call.
 */
export const WECHAT_ARTICLE_SYSTEM_PROMPT = `${CONTENT_AGENT_SHARED_RULES}

You are writing a complete, publish-ready WeChat Official Account (公众号) article directly from the Research Pack — there is no separate outline step. Write it as a numbered thought-leadership analysis, not a plain Q&A explainer:

full_article structure:
1. Opens with a concrete news hook — the actual event, date, who/what — 2-4 sentences, scene-setting, not a policy summary. A first-person anecdote opener is also a real, legitimate alternative (e.g. "5月14号晚上...我刚结束一个客户会议，路过...看见...") when it genuinely fits the topic — but it's a framing device (category B editorial texture), never a vehicle for a new factual claim that isn't in the Research Pack.
2. Immediately reframes it through the company's practitioner lens: not just "what happened" but "what this actually signals" — 1-2 sentences stating the real thesis of the piece.
3. The body is broken into numbered sections using Chinese numerals ("一、" "二、" "三、" ...) directly followed by a short section title on the same line (e.g. "一、说结果：工党输了什么？") — this is what real published articles actually use; do not use "## 01" digit-style numbering. Each section covers: the underlying dynamics/context, what specifically changes or is at stake, who is affected and how, and concrete next steps. Vary the count to fit the topic (3-6 sections is typical) — never pad with a section that has nothing real to say. When you name a specific outlet or report as the source of a fact (e.g. 卫报, 路透社, 内政部报告, 上议院委员会报告), say so directly in the prose ("《卫报》报道称..." / "内政事务委员会报告提到...") rather than writing generically "有报道指出" — this is how the real articles read, and it's what source_references is grounding.
4. At least one section must break its advice down BY AUDIENCE SEGMENT (e.g. 对留学生 / 对雇主 / 对正在申请XX签证的人 / 对家庭团聚申请人 — pick the segments that actually apply to this topic), each with one concrete, actionable takeaway — not the same generic advice repeated for everyone.
5. When the Research Pack supports a real historical sequence of dated milestones, a dated timeline reads well as its own section ("2015年12月：... / 2016年6月：... / ...", one dated entry per line).
6. Numbered-section analysis is still bound by the evidence rule above: the underlying facts/dates/rules must trace to the Research Pack; the practitioner "what this means" framing is editorial judgment (category B), not a new fact.
7. Formatting matters as much as the writing — WeChat readers are on mobile and bounce off a dense wall of text immediately. Never write a block of 3+ sentences run together. Instead:
   - Write short lines, mostly one sentence or one short clause each, with a blank line (double newline) between almost every line — the WeChat-native "一句一行" reading rhythm, not Western-style paragraphs. This is about line length and spacing, NOT about turning the article into a list — most of the piece is still ordinary flowing lines of prose, just short ones, not bullets.
   - The "一、" / "二、" / "三、" section-title lines (point 3) are the only place a heading appears — do not invent any other heading level.
   - Bullets ("▪️", one per line) are for the rare case of genuinely parallel data points that read naturally as a list (e.g. several parties' poll numbers) — use them sparingly, only when the content actually IS a list; do not convert ordinary sentences into bullets just for visual effect.
   - Wrap the specific numbers, dates, and pivotal phrases a skimming reader should catch in **markdown bold** (e.g. "**25%**", "**5月27日**") — besides the section-title lines, this is the ONLY other markdown syntax ever used; it renders as real emphasis, not literal asterisks, so use it deliberately, not on every other word.
   - A short rhetorical question or transition beat can stand alone on its own line before its answer (e.g. "为什么？").
   - Use an em dash ("——") to link a short lead-in clause to what follows, instead of a comma-joined run-on sentence.

full_article should read like an experienced practitioner explaining the real stakes to a client, not a news summary or a government notice — confident, specific, a little wry, never hedging with disclaimers inside the body text. closing_note is the final numbered section in the same "一、二、三..." sequence as full_article (continue the numbering, e.g. if full_article ends at "六、" then closing_note is "七、李尔王怎么看？" or "...、李尔王想说") — a first-person reflection that ties the topic back to the company's long-standing presence/experience, then ends with a soft call-to-action (e.g. "欢迎关注和订阅李尔王移民") — not a hard sales pitch; the brand footer is appended separately after this, do not write it yourself. closing_note follows the same short-line formatting as full_article (point 7 above), not one dense paragraph. title_options is 5 candidate headlines, in the "concrete claim + company deep-dive" style (e.g. "XX事件背后的'YY'：ZZ，到底NN？李尔王国际移民深度解读"). summary is a short lead-in/abstract shown before the article body. golden_quotes is exactly 3 short, quotable lines pulled from or written for the article, suitable for pull-quotes or social sharing. cover_title/cover_subtitle/cover_visual_direction describe the article's cover image (short headline text, a one-line subtitle, and a plain-language direction for what the cover should depict) — for the image designer, not for the article body. share_caption is a short caption for sharing this article link (e.g. to WeChat Moments/群聊), ending with a couple of relevant hashtags.`;

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
    textFieldsForScan: (c: VideoChannelContent) => [
      c.title,
      c.hook,
      c.cover_text,
      c.full_script,
      c.cta,
      c.publish_title,
      c.publish_caption,
    ],
  } satisfies ContentTaskConfig<VideoChannelContent>,
  XIAOHONGSHU_WRITING: {
    systemPrompt: XHS_SYSTEM_PROMPT,
    taskInstruction: "Write the Xiaohongshu title and caption now, following the rules above.",
    schema: XiaohongshuContentSchema,
    maxTokens: 4000,
    textFieldsForScan: (c: XiaohongshuContent) => [...c.title_options, c.cover_title, c.caption],
  } satisfies ContentTaskConfig<XiaohongshuContent>,
  XIAOHONGSHU_PAGES_PLANNING: {
    systemPrompt: XHS_PAGES_SYSTEM_PROMPT,
    taskInstruction: "Plan the Xiaohongshu 图文 page-by-page image-text content now, following the rules above.",
    schema: XiaohongshuPagesPlanSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: XiaohongshuPagesPlan) => [...c.pages],
  } satisfies ContentTaskConfig<XiaohongshuPagesPlan>,
  WECHAT_WRITING: {
    systemPrompt: WECHAT_OUTLINE_SYSTEM_PROMPT,
    taskInstruction:
      "Write the WeChat Official Account OUTLINE now (not the full article), following the rules above.",
    schema: WechatOutlineSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: WechatOutline) => [...c.title_options, c.summary, ...c.detailed_outline, ...c.key_claims],
  } satisfies ContentTaskConfig<WechatOutline>,
  WECHAT_ARTICLE_WRITING: {
    systemPrompt: WECHAT_ARTICLE_SYSTEM_PROMPT,
    taskInstruction:
      "Write the complete, publish-ready WeChat Official Account ARTICLE now (no outline step), following the rules above.",
    schema: WechatArticleSchema,
    maxTokens: 16000,
    textFieldsForScan: (c: WechatArticle) => [
      c.title,
      ...c.title_options,
      c.summary,
      c.full_article,
      c.closing_note,
      ...c.golden_quotes,
      c.cover_title,
      c.cover_subtitle,
      c.share_caption,
    ],
  } satisfies ContentTaskConfig<WechatArticle>,
} as const;

export type GenericContentTaskType = keyof typeof CONTENT_TASK_CONFIG;

// ---------------------------------------------------------------------
// Employee H（终审修改员）— takes a draft Employee G（合规审核员）already
// flagged issues in, and produces a revised version that fixes ONLY those
// flagged issues. Still not a final approval: the human reviews the
// revised draft like any other version before it's published.
// ---------------------------------------------------------------------

const REVISION_ADDENDUM = `You are now REVISING an existing draft, not writing a new one from scratch. A compliance reviewer already flagged specific issues in it (quoted exactly, below). Fix ONLY those flagged issues — keep wording, structure, tone, and length unchanged everywhere else unless a change is strictly necessary to fix a flagged issue. Do not introduce any new claim beyond what the original draft and the Research Pack already support. Output the complete revised piece in the same structured format as the original, not just the changed parts.`;

export const VIDEO_REVISION_SYSTEM_PROMPT = `${VIDEO_SYSTEM_PROMPT}\n\n${REVISION_ADDENDUM}`;
export const XHS_REVISION_SYSTEM_PROMPT = `${XHS_SYSTEM_PROMPT}\n\n${REVISION_ADDENDUM}`;
export const XHS_PAGES_REVISION_SYSTEM_PROMPT = `${XHS_PAGES_SYSTEM_PROMPT}\n\n${REVISION_ADDENDUM}`;
export const WECHAT_ARTICLE_REVISION_SYSTEM_PROMPT = `${WECHAT_ARTICLE_SYSTEM_PROMPT}\n\n${REVISION_ADDENDUM}`;

/** Renders the existing draft + the compliance findings to fix into one context block, appended after buildEvidenceContextBlock's output. */
export function buildRevisionContextBlock(
  existingContentText: string,
  findings: Array<{ issue_type: string; quote: string; explanation: string }>,
): string {
  const lines = [
    "=== 需要修改的现有草稿 ===",
    existingContentText,
    "",
    "=== 合规审核员标出的问题（只修复下面这些，其余保持不变）===",
    ...findings.map((f, i) => `${i + 1}. [${f.issue_type}] 原文："${f.quote}"\n   问题：${f.explanation}`),
  ];
  return lines.join("\n");
}

export const REVISION_TASK_CONFIG = {
  VIDEO_REVISION: {
    systemPrompt: VIDEO_REVISION_SYSTEM_PROMPT,
    taskInstruction: "Revise the VIDEO_CHANNEL script now to fix only the flagged issues above, following the rules above.",
    schema: VideoChannelContentSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: VideoChannelContent) => [
      c.title,
      c.hook,
      c.cover_text,
      c.full_script,
      c.cta,
      c.publish_title,
      c.publish_caption,
    ],
  } satisfies ContentTaskConfig<VideoChannelContent>,
  XIAOHONGSHU_REVISION: {
    systemPrompt: XHS_REVISION_SYSTEM_PROMPT,
    taskInstruction: "Revise the Xiaohongshu title/caption now to fix only the flagged issues above, following the rules above.",
    schema: XiaohongshuContentSchema,
    maxTokens: 4000,
    textFieldsForScan: (c: XiaohongshuContent) => [...c.title_options, c.cover_title, c.caption],
  } satisfies ContentTaskConfig<XiaohongshuContent>,
  XIAOHONGSHU_PAGES_REVISION: {
    systemPrompt: XHS_PAGES_REVISION_SYSTEM_PROMPT,
    taskInstruction: "Revise the Xiaohongshu 图文 page plan now to fix only the flagged issues above, following the rules above.",
    schema: XiaohongshuPagesPlanSchema,
    maxTokens: 8000,
    textFieldsForScan: (c: XiaohongshuPagesPlan) => [...c.pages],
  } satisfies ContentTaskConfig<XiaohongshuPagesPlan>,
  WECHAT_ARTICLE_REVISION: {
    systemPrompt: WECHAT_ARTICLE_REVISION_SYSTEM_PROMPT,
    taskInstruction:
      "Revise the WeChat Official Account ARTICLE now to fix only the flagged issues above, following the rules above.",
    schema: WechatArticleSchema,
    maxTokens: 16000,
    textFieldsForScan: (c: WechatArticle) => [
      c.title,
      ...c.title_options,
      c.summary,
      c.full_article,
      c.closing_note,
      ...c.golden_quotes,
      c.cover_title,
      c.cover_subtitle,
      c.share_caption,
    ],
  } satisfies ContentTaskConfig<WechatArticle>,
} as const;

export type RevisionTaskType = keyof typeof REVISION_TASK_CONFIG;
