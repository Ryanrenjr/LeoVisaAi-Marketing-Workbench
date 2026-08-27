import { RESEARCH_SCORE_DIMENSIONS, hasScoreData } from "@/lib/ai/research-pack";
import { CONFIDENCE_LABEL } from "@/lib/status";
import { bossScoreLabel } from "@/lib/boss-language";
import type { ResearchPack, ResearchScoreBreakdown, ResearchSource, ScoreBreakdown } from "@/lib/types";

/**
 * `topic_score`/`score_breakdown` (see src/lib/scoring.ts) — surfaced here
 * so the researcher sees it right next to the research quality signal
 * (ConfidenceBadge), rather than buried in a collapsed admin-only panel.
 */
function ScoreCard({ score, breakdown }: { score: number; breakdown: ScoreBreakdown }) {
  return (
    <div className="card flex flex-col gap-1 px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{score}</span>
        <span className="text-sm text-[var(--muted)]">/ 100 分 · 选题分数</span>
      </div>
      <p className="text-base">{bossScoreLabel(score)}</p>
      <p className="text-sm text-[var(--muted)]">
        优先级 {breakdown.priority}/60 分（选题标记为「高」「中」「低」决定） · 信息完整度 {breakdown.completeness}/40 分（业务线、目标受众、内容支柱、核心问题这
        4 项每填一项 10 分）
      </p>
      <p className="text-sm text-[var(--muted)]">50 分以上算合格，可以继续做研究；低于 50 分建议先把选题信息补充完整。</p>
    </div>
  );
}

/** A ratio ≥0.8 reads as green ("good"), ≥0.5 as amber ("okay, check it"), below as red ("weak") — color as a second, at-a-glance channel alongside the number itself, not a replacement for it. */
function scoreTone(ratio: number): { text: string; bar: string } {
  if (ratio >= 0.8) return { text: "text-green-700 dark:text-green-400", bar: "bg-green-600" };
  if (ratio >= 0.5) return { text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" };
  return { text: "text-red-700 dark:text-red-400", bar: "bg-red-600" };
}

/**
 * B｜政策研究员的六项打分——每一项从哪个方面打分、打了几分，直接摆出来，
 * 不用点开、不用猜。字号刻意放大（live user instruction: "字大一点，UI设计
 * 智障友好一点"）。旧的研究结果（这个功能上线之前生成的）没有打分数据，
 * 显示一句说明而不是硬凑一个误导人的 0 分。
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
      <div className="flex items-baseline gap-3">
        <span className={`text-5xl font-bold ${tone.text}`}>{total}</span>
        <span className="text-lg text-[var(--muted)]">/ 100 分 · 研究质量评分</span>
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
 * Always rendered whenever a research pack is shown, regardless of what
 * the model output says — this is a deterministic control, not something
 * that depends on the AI remembering to add its own disclaimer. See
 * docs/security-boundaries.md "AI usage".
 */
function ExpertWarningBanner() {
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-base text-amber-900 dark:text-amber-200">
      <p className="font-medium">专家审阅须知</p>
      <p className="mt-1">
        本内容为 AI 生成的一般性营销研究资料，<strong>不构成个人化法律意见</strong>
        ，不针对任何具体客户案件。请在批准前核实来源真实性与内容准确性，并确认内容中不包含任何真实客户信息。
      </p>
    </div>
  );
}

/** Stronger, distinct styling for LOW confidence — deliberately harder to miss than MEDIUM/HIGH. */
function ConfidenceBadge({ confidence }: { confidence: ResearchPack["confidence"] }) {
  if (confidence === "LOW") {
    return (
      <div className="rounded-md border border-red-600/40 bg-red-600/10 px-4 py-3 text-base text-red-900 dark:text-red-200">
        <p className="font-medium">⚠ 低置信度</p>
        <p className="mt-1">
          模型对本次研究结果的把握较低（来源较薄弱、结论存在分歧，或与主题关联不够明确）。批准前请格外仔细核实每条来源。
        </p>
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
  topic?: { topic_score: number; score_breakdown: ScoreBreakdown };
}) {
  return (
    <div className="flex flex-col gap-4">
      {topic && <ScoreCard score={topic.topic_score} breakdown={topic.score_breakdown} />}
      <ExpertWarningBanner />
      <ConfidenceBadge confidence={pack.confidence} />
      <ResearchScoreBoard total={pack.score_total ?? 0} breakdown={pack.score_breakdown} />

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
