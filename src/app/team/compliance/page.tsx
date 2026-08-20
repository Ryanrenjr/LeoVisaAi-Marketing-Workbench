import Link from "next/link";
import {
  getAllComplianceReviews,
  getAllContentAssets,
  getAllTopics,
  isDemoMode,
} from "@/lib/topics";
import { getEmployeeNames } from "@/lib/employee-names";
import { getCurrentUser } from "@/lib/auth";
import { groupContentAssetsByTopicId } from "@/lib/content-versions";
import { buildComplianceQueue } from "@/lib/employee-tasks";
import { canRunCompliance } from "@/lib/permissions";
import { resolveEmployeeDisplayName } from "@/lib/boss-language";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { runComplianceReview } from "@/app/topics/compliance-actions";
import type { ComplianceReviewRow, ContentPlatform } from "@/lib/types";

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

function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
      {RISK_LABEL[risk] ?? risk}
    </span>
  );
}

function ReviewResult({ review }: { review: ComplianceReviewRow }) {
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

export default async function CompliancePage() {
  const [demo, user, topics, contentAssets, reviews, employeeNames] = await Promise.all([
    isDemoMode(),
    getCurrentUser(),
    getAllTopics(),
    getAllContentAssets(),
    getAllComplianceReviews(),
    getEmployeeNames(),
  ]);

  const contentAssetsByTopicId = groupContentAssetsByTopicId(contentAssets);
  const reviewsByContentAssetId = new Map<string, ComplianceReviewRow>();
  for (const review of reviews) {
    // reviews are sorted newest-first, keep only the first (latest) per asset
    if (!reviewsByContentAssetId.has(review.content_asset_id)) {
      reviewsByContentAssetId.set(review.content_asset_id, review);
    }
  }

  const queue = buildComplianceQueue(topics, contentAssetsByTopicId, reviewsByContentAssetId);
  const needsAttention = queue.filter(
    (item) => !item.latestReview || item.latestReview.overall_risk !== "LOW",
  );
  const clear = queue.filter((item) => item.latestReview && item.latestReview.overall_risk === "LOW");

  const canRun = !demo && user && canRunCompliance(user.role);
  const employeeName = resolveEmployeeDisplayName("compliance", employeeNames);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
            D
          </span>
          <h1 className="text-lg font-semibold">{employeeName}</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          重新核对内容有没有超出研究依据、有没有个性化建议措辞、有没有夸大宣传用语。只给建议，不做最终判断——发布前仍需要人确认。
        </p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">需要确认（{needsAttention.length}）</h2>
        {needsAttention.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">暂无需要确认的内容。</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {needsAttention.map((item) => (
              <li key={item.contentAssetId} className="border-b border-[var(--border)] pb-4 last:border-b-0">
                <div className="flex items-center justify-between gap-4">
                  <Link href={`/topics/${item.topicId}`} className="min-w-0 truncate font-medium hover:underline">
                    {item.topicTitle}
                  </Link>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {CONTENT_PLATFORM_LABEL[item.platformLabel as ContentPlatform] ?? item.platformLabel}
                  </span>
                </div>
                {item.latestReview && <ReviewResult review={item.latestReview} />}
                {canRun && (
                  <form action={runComplianceReview.bind(null, item.contentAssetId)} className="mt-2">
                    <Button type="submit" variant="secondary" className="text-sm">
                      {item.latestReview ? "重新审核" : "运行合规审核"}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {clear.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">已确认无明显问题（{clear.length}）</h2>
          <ul>
            {clear.map((item) => (
              <li
                key={item.contentAssetId}
                className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2 text-sm last:border-b-0"
              >
                <Link href={`/topics/${item.topicId}`} className="min-w-0 truncate hover:underline">
                  {item.topicTitle}
                </Link>
                <span className="shrink-0 text-[var(--muted)]">
                  {CONTENT_PLATFORM_LABEL[item.platformLabel as ContentPlatform] ?? item.platformLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
