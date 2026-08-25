import Link from "next/link";
import { getAllComplianceReviews, getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getEmployeeNames } from "@/lib/employee-names";
import { getCurrentUser } from "@/lib/auth";
import { groupContentAssetsByTopicId } from "@/lib/content-versions";
import { buildComplianceQueue } from "@/lib/employee-tasks";
import { canManageContentAssets } from "@/lib/permissions";
import { CONTENT_TYPE_REVISION } from "@/lib/content-mapping";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { GenerateAction } from "@/components/ai/generate-action";
import { EmployeeHeader } from "@/components/employee-header";
import { reviseContentAsset } from "@/app/topics/revision-actions";
import { ComplianceReviewResult } from "@/components/compliance-review-result";
import type { ComplianceReviewRow, ContentPlatform } from "@/lib/types";
import type { RevisionTaskType } from "@/lib/ai/content-schemas";

export default async function ReviserPage() {
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
    if (!reviewsByContentAssetId.has(review.content_asset_id)) {
      reviewsByContentAssetId.set(review.content_asset_id, review);
    }
  }

  const queue = buildComplianceQueue(topics, contentAssetsByTopicId, reviewsByContentAssetId);
  const needsRevision = queue.filter((item) => item.latestReview && item.latestReview.overall_risk !== "LOW");

  const canRun = !demo && user && canManageContentAssets(user.role);
  const taskTypes: RevisionTaskType[] = [
    "VIDEO_REVISION",
    "XIAOHONGSHU_REVISION",
    "XIAOHONGSHU_PAGES_REVISION",
    "WECHAT_ARTICLE_REVISION",
  ];
  const modelOptionsByTaskType = canRun
    ? Object.fromEntries(await Promise.all(taskTypes.map(async (t) => [t, await getTaskModelOptions(t)] as const)))
    : null;

  const employee = getEmployee("reviser");
  const employeeName = resolveEmployeeDisplayName("reviser", employeeNames);

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="reviser"
        letter={employee.letter}
        name={employeeName}
        subtitle="合规审核员标出问题后，把被标出的地方改好，出一版新的草稿给你确认。只改被标出的问题，其他地方不动。"
      />

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">待修改（{needsRevision.length}）</h2>
        {needsRevision.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">暂无需要修改的内容。</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {needsRevision.map((item) => {
              const platform = item.platformLabel as ContentPlatform;
              const revisionTaskType = CONTENT_TYPE_REVISION[item.contentType];
              const canRevise = Boolean(revisionTaskType);
              const modelOptions = revisionTaskType ? (modelOptionsByTaskType?.[revisionTaskType] ?? null) : null;
              return (
                <li key={item.contentAssetId} className="border-b border-[var(--border)] pb-4 last:border-b-0">
                  <div className="flex items-center justify-between gap-4">
                    <Link href={`/topics/${item.topicId}`} className="min-w-0 truncate font-medium hover:underline">
                      {item.topicTitle}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {CONTENT_PLATFORM_LABEL[platform] ?? item.platformLabel}
                    </span>
                  </div>
                  {item.latestReview && <ComplianceReviewResult review={item.latestReview} />}
                  {canRun && (
                    <div className="mt-2">
                      {canRevise && revisionTaskType && modelOptions ? (
                        <GenerateAction
                          action={async (override) => {
                            "use server";
                            await reviseContentAsset(item.contentAssetId, override);
                          }}
                          label="生成修改版"
                          taskType={revisionTaskType}
                          className="w-full py-3"
                          models={modelOptions.models}
                          defaultModel={modelOptions.defaultModel}
                          resolutionError={modelOptions.resolutionError}
                        />
                      ) : (
                        <p className="rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--muted)] opacity-60">
                          该版本较旧，暂不支持 AI 自动修改，请手动编辑。
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
