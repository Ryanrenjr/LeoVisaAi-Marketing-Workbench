import { RESEARCH_SCORE_DIMENSIONS, diagnoseResearchScore, hasScoreData } from "@/lib/ai/research-pack";
import { CONFIDENCE_LABEL } from "@/lib/status";
import { bossScoreLabel } from "@/lib/boss-language";
import type { ResearchPack, ResearchScoreBreakdown, ResearchSource } from "@/lib/types";

/**
 * `topic.topic_score` — A｜选题策划员's "值不值得做" score, set BEFORE
 * research even starts (see src/lib/scoring.ts). Live product instruction:
 * this used to render as its own big card, the same visual weight as
 * 研究可靠度 below (`ResearchScoreBoard`) — a user could not tell at a
 * glance which number was "is this a good idea" versus "can we publish
 * this yet", and the two can legitimately disagree (a great topic idea
 * can still have thin evidence; solid evidence can back a mediocre idea).
 * Deliberately understated here — a single muted line, not a card — so
 * 研究可靠度 is unambiguously the page's primary number.
 */
function TopicValueNote({ score }: { score: number }) {
  return (
    <p className="text-sm text-[var(--muted)]">
      选题价值 {score}/100 · {bossScoreLabel(score)}
      <span className="ml-1.5">（这个题值不值得做——与下面的研究可靠度是两个独立的判断）</span>
    </p>
  );
}

/** A ratio ≥0.8 reads as green ("good"), ≥0.5 as amber ("okay, check it"), below as red ("weak") — color as a second, at-a-glance channel alongside the number itself, not a replacement for it. */
function scoreTone(ratio: number): { text: string; bar: string } {
  if (ratio >= 0.8) return { text: "text-green-700 dark:text-green-400", bar: "bg-green-600" };
  if (ratio >= 0.5) return { text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" };
  return { text: "text-red-700 dark:text-red-400", bar: "bg-red-600" };
}

/**
 * "研究可靠度" — B｜政策研究员的六项打分，这个页面上唯一决定"现在能不能发"
 * 的分数（见 research-pack.ts 的 canApproveResearchScore/
 * researchDecisionTier）。每一项从哪个方面打分、打了几分，直接摆出来，不用
 * 点开、不用猜。字号刻意放大（live user instruction: "字大一点，UI设计智障
 * 友好一点"），且是页面视觉上的主角——不要和下面的"选题价值"（TopicValueNote，
 * 那是完全不同的、选题阶段就定了的分数）混在一起。旧的研究结果（这个功能上
 * 线之前生成的）没有打分数据，显示一句说明而不是硬凑一个误导人的 0 分。
 */
function ResearchScoreBoard({ total, breakdown }: { total: number; breakdown: ResearchScoreBreakdown | null }) {
  if (!hasScoreData(breakdown)) {
    return (
      <div className="card px-5 py-4">
        <p className="text-base text-[var(--muted)]">这次研究还没有六项打分（早于打分功能上线，或本次生成时打分失败）。</p>
      </div>
    );
  }

  const tone = scoreTone(total / 100);

  return (
    <div className="card flex flex-col gap-5 px-5 py-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <span className={`text-5xl font-bold ${tone.text}`}>{total}</span>
          <span className="text-lg text-[var(--muted)]">/ 100 分 · 研究可靠度</span>
        </div>
        <p className="text-sm text-[var(--muted)]">现有证据是否足够支持公开内容</p>
      </div>

      <div className="flex flex-col gap-4">
        {RESEARCH_SCORE_DIMENSIONS.map((dim) => {
          const item = breakdown[dim.field];
          const ratio = item.max > 0 ? item.score / item.max : 0;
          const itemTone = scoreTone(ratio);
          return (
            <div key={dim.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-lg font-medium">{dim.label}</span>
                <span className={`text-2xl font-semibold ${itemTone.text}`}>
                  {item.score}
                  <span className="text-base font-normal text-[var(--muted)]"> / {item.max} 分</span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className={`h-full rounded-full ${itemTone.bar}`}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              {item.reason && <p className="text-base text-[var(--muted)]">{item.reason}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "研究诊断" — a deterministic UI mapping from the six-dimension score to
 * the 2-4 problems that actually matter, so a user never has to read six
 * separate score bars and infer for themselves what's wrong (live product
 * instruction: this must NOT be another AI call just to restate `reason`
 * more nicely — see diagnoseResearchScore's own doc comment). Renders
 * nothing when every dimension is already healthy — a clean pack doesn't
 * need a diagnosis section telling it so.
 */
function ResearchDiagnosisBoard({ breakdown }: { breakdown: ResearchScoreBreakdown | null }) {
  const items = diagnoseResearchScore(breakdown);
  if (items.length === 0) return null;

  return (
    <div className="card flex flex-col gap-3 px-5 py-4">
      <p className="text-base font-medium">研究诊断</p>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span
              className={`text-base font-medium ${item.severity === "HIGH" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}
            >
              {item.severity === "HIGH" ? "🔴" : "🟡"} {item.label}
            </span>
            <span className="text-sm text-[var(--muted)]">{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Always rendered whenever a research pack is shown, regardless of what
 * the model output says — this is a deterministic control, not something
 * that depends on the AI remembering to add its own disclaimer. See
 * docs/security-boundaries.md "AI usage".
 */
function ExpertWarningBanner() {
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-base text-amber-900 dark:text-amber-200">
      AI 生成的一般资料，不是正式法律意见，批准前请核实来源。
    </div>
  );
}

/** Stronger, distinct styling for LOW confidence — deliberately harder to miss than MEDIUM/HIGH. */
function ConfidenceBadge({ confidence }: { confidence: ResearchPack["confidence"] }) {
  if (confidence === "LOW") {
    return (
      <div className="rounded-md border border-red-600/40 bg-red-600/10 px-4 py-3 text-base text-red-900 dark:text-red-200">
        ⚠ 低置信度，请仔细核实来源。
      </div>
    );
  }
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)]">
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

export function ResearchPackView({
  pack,
  sources,
  topic,
}: {
  pack: ResearchPack;
  sources: ResearchSource[];
  topic?: { topic_score: number };
}) {
  return (
    <div className="flex flex-col gap-4">
      <ExpertWarningBanner />
      <ConfidenceBadge confidence={pack.confidence} />
      <ResearchScoreBoard total={pack.score_total ?? 0} breakdown={pack.score_breakdown} />
      <ResearchDiagnosisBoard breakdown={pack.score_breakdown} />
      {topic && <TopicValueNote score={topic.topic_score} />}

      <div>
        <p className="text-sm text-[var(--muted)]">研究摘要</p>
        <p className="mt-1 text-base">{pack.summary}</p>
      </div>

      {pack.key_findings.length > 0 && (
        <div>
          <p className="text-sm text-[var(--muted)]">关键发现</p>
          <ul className="mt-1 list-disc pl-5 text-base">
            {pack.key_findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-sm text-[var(--muted)]">来源（{sources.length}）</p>
        {sources.length === 0 ? (
          <p className="mt-1 text-base text-[var(--muted)]">暂无可验证来源。</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {sources.map((source) => (
              <li key={source.id} className="text-base">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {source.title}
                </a>
                {source.page_age && (
                  <span className="ml-2 text-sm text-[var(--muted)]">（{source.page_age}）</span>
                )}
                {source.note && <p className="text-sm text-[var(--muted)]">{source.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pack.warnings && (
        <div>
          <p className="text-sm text-[var(--muted)]">模型注意事项</p>
          <p className="mt-1 text-base text-[var(--muted)]">{pack.warnings}</p>
        </div>
      )}

      {pack.edited_by && (
        <p className="text-xs text-[var(--muted)]">
          最后由人工编辑于 {new Date(pack.edited_at!).toLocaleString("zh-CN")}
        </p>
      )}
    </div>
  );
}
