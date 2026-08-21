import type { ComplianceReviewRow } from "@/lib/types";

/**
 * One compliance review's result — extracted from src/app/team/compliance/page.tsx
 * so the topic detail page's own "合规" tab renders identically instead of
 * duplicating this. Pure presentation, no logic change.
 */

const RISK_LABEL: Record<string, string> = {
  LOW: "未发现明显问题",
  MEDIUM: "有几处建议确认",
  HIGH: "有需要重点确认的问题",
};

const ISSUE_TYPE_LABEL: Record<string, string> = {
  unsupported_claim: "超出研究依据",
  individualized_advice: "个性化建议措辞",
  hype_language: "夸大/紧迫用语",
  outdated_or_unverifiable: "信息可能已过时",
  other: "其他",
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
      {RISK_LABEL[risk] ?? risk}
    </span>
  );
}

export function ComplianceReviewResult({ review }: { review: ComplianceReviewRow }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--muted)]">
          {new Date(review.created_at).toLocaleString("zh-CN")} 审核结果
        </span>
        <RiskBadge risk={review.overall_risk} />
      </div>
      {review.findings.length === 0 ? (
        <p className="text-[var(--muted)]">自动检查未发现明显问题，仍建议人工过一遍再发布。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {review.findings.map((f, i) => (
            <li key={i} className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
              <p className="text-xs text-[var(--muted)]">{ISSUE_TYPE_LABEL[f.issue_type] ?? f.issue_type}</p>
              <p className="mt-0.5">&ldquo;{f.quote}&rdquo;</p>
              <p className="mt-0.5 text-[var(--muted)]">{f.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
