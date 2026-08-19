import { CONFIDENCE_LABEL } from "@/lib/status";
import type { ResearchPack, ResearchSource } from "@/lib/types";

/**
 * Always rendered whenever a research pack is shown, regardless of what
 * the model output says — this is a deterministic control, not something
 * that depends on the AI remembering to add its own disclaimer. See
 * docs/security-boundaries.md "AI usage".
 */
function ExpertWarningBanner() {
  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
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
      <div className="rounded-md border border-red-600/40 bg-red-600/10 px-4 py-3 text-sm text-red-900 dark:text-red-200">
        <p className="font-medium">⚠ 低置信度</p>
        <p className="mt-1">
          模型对本次研究结果的把握较低（来源较薄弱、结论存在分歧，或与主题关联不够明确）。批准前请格外仔细核实每条来源。
        </p>
      </div>
    );
  }
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

export function ResearchPackView({
  pack,
  sources,
}: {
  pack: ResearchPack;
  sources: ResearchSource[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <ExpertWarningBanner />
      <ConfidenceBadge confidence={pack.confidence} />

      <div>
        <p className="text-xs text-[var(--muted)]">研究摘要</p>
        <p className="mt-1 text-sm">{pack.summary}</p>
      </div>

      {pack.key_findings.length > 0 && (
        <div>
          <p className="text-xs text-[var(--muted)]">关键发现</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {pack.key_findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs text-[var(--muted)]">来源（{sources.length}）</p>
        {sources.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--muted)]">暂无可验证来源。</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {sources.map((source) => (
              <li key={source.id} className="text-sm">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {source.title}
                </a>
                {source.page_age && (
                  <span className="ml-2 text-xs text-[var(--muted)]">（{source.page_age}）</span>
                )}
                {source.note && <p className="text-[var(--muted)]">{source.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pack.warnings && (
        <div>
          <p className="text-xs text-[var(--muted)]">模型注意事项</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{pack.warnings}</p>
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
