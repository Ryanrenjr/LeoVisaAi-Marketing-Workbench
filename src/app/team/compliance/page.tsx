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
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { GenerateAction } from "@/components/ai/generate-action";
import { EmployeeHeader } from "@/components/employee-header";
import { runComplianceReview } from "@/app/topics/compliance-actions";
import { ComplianceReviewResult } from "@/components/compliance-review-result";
import type { ComplianceReviewRow, ContentPlatform } from "@/lib/types";

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
  const modelOptions = canRun ? await getTaskModelOptions("COMPLIANCE") : null;
  const employee = getEmployee("compliance");
  const employeeName = resolveEmployeeDisplayName("compliance", employeeNames);

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="compliance"
        letter={employee.letter}
        name={employeeName}
        subtitle="重新核对内容有没有超出研究依据、有没有个性化建议措辞、有没有夸大宣传用语。只给建议，不做最终判断——发布前仍需要人确认。"
      />

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
                {item.latestReview && <ComplianceReviewResult review={item.latestReview} />}
                {canRun && modelOptions && (
                  <div className="mt-2">
                    <GenerateAction
                      action={runComplianceReview.bind(null, item.contentAssetId)}
                      label={item.latestReview ? "重新审核" : "运行合规审核"}
                      taskType="COMPLIANCE"
                      className="w-full py-3"
                      models={modelOptions.models}
                      defaultModel={modelOptions.defaultModel}
                      resolutionError={modelOptions.resolutionError}
                    />
                  </div>
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
