import { getAllComplianceReviews, getAllContentAssets, getAllTopics, getLibraryTopics, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { timeBasedGreeting, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { getRecentPublishPerformanceCount } from "@/lib/analytics";
import { getAllContentImages } from "@/lib/content-images";
import {
  buildComplianceQueue,
  filterContentEligibleTopics,
  summarizeEditorTasks,
  summarizePlannerTasks,
  summarizeResearcherTasks,
} from "@/lib/employee-tasks";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { LaneCard, LaneGroup, StageRow } from "@/components/pipeline-flow";
import type { ComplianceReviewRow } from "@/lib/types";
import Link from "next/link";

function DemoNotice() {
  return (
    <p className="card px-4 py-3 text-sm text-[var(--muted)]">
      当前为演示数据（未连接 Supabase）。配置 .env.local 后将显示真实数据。
    </p>
  );
}

async function BossHome({ demo }: { demo: boolean }) {
  const user = await getCurrentUser();
  const [
    libraryTopics,
    allTopics,
    allContentAssets,
    complianceReviews,
    performanceCount,
    contentImages,
    employeeNames,
  ] = await Promise.all([
    getLibraryTopics(),
    getAllTopics(),
    getAllContentAssets(),
    getAllComplianceReviews(),
    getRecentPublishPerformanceCount(),
    getAllContentImages(),
    getEmployeeNames(),
  ]);

  const contentAssetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  const eligibleTopics = filterContentEligibleTopics(allTopics);

  const reviewsByContentAssetId = new Map<string, ComplianceReviewRow>();
  for (const review of complianceReviews) {
    if (!reviewsByContentAssetId.has(review.content_asset_id)) {
      reviewsByContentAssetId.set(review.content_asset_id, review);
    }
  }
  const complianceQueue = buildComplianceQueue(allTopics, contentAssetsByTopicId, reviewsByContentAssetId);

  const plannerSummary = summarizePlannerTasks(libraryTopics);
  const researcherSummary = summarizeResearcherTasks(libraryTopics);
  const videoSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "VIDEO_CHANNEL");
  const xiaohongshuSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "XIAOHONGSHU");
  const wechatSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "WECHAT_OFFICIAL_ACCOUNT");
  const xhsPagesPending = eligibleTopics.filter(
    (t) => !getLatestForLineage(contentAssetsByTopicId.get(t.id) ?? [], "XIAOHONGSHU", "xiaohongshu_pages"),
  ).length;
  const complianceAttentionItems = complianceQueue.filter(
    (item) => !item.latestReview || item.latestReview.overall_risk !== "LOW",
  );
  const needsRevisionItems = complianceQueue.filter(
    (item) => item.latestReview && item.latestReview.overall_risk !== "LOW",
  );

  const xiaohongshuDraftTopicIds = eligibleTopics
    .filter((t) => getLatestForLineage(contentAssetsByTopicId.get(t.id) ?? [], "XIAOHONGSHU", "xiaohongshu_post"))
    .map((t) => t.id);
  const topicsWithImages = new Set(contentImages.map((img) => img.topic_id));
  const imagePendingCount = xiaohongshuDraftTopicIds.filter((id) => !topicsWithImages.has(id)).length;

  const greeting = timeBasedGreeting(new Date().getHours());
  const name = user?.displayName ?? "老板";

  return (
    <div className="flex flex-col gap-10">
      {demo && <DemoNotice />}

      <section className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}，{name}。
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">你的数字团队正在工作。</p>
        </div>
        <Link
          href="/team/handbook"
          className="shrink-0 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
        >
          📖 数字员工手册
        </Link>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">工作流程 · 共 9 步</h2>

        <StageRow
          avatarId="planner"
          step={1}
          name={resolveEmployeeDisplayName("planner", employeeNames)}
          status={plannerSummary.todayCandidates > 0 ? `今日候选 ${plannerSummary.todayCandidates} 个` : "空闲"}
          actionLabel="查看选题"
          href="/team/planner"
          kind="auto"
        />
        <StageRow
          avatarId="researcher"
          step={2}
          name={resolveEmployeeDisplayName("researcher", employeeNames)}
          status={
            researcherSummary.awaitingReview > 0
              ? `等你确认 ${researcherSummary.awaitingReview} 篇`
              : researcherSummary.inProgress > 0
                ? `研究中 ${researcherSummary.inProgress} 篇`
                : "空闲"
          }
          actionLabel="查看研究"
          href="/team/researcher"
          kind="auto"
        />
        <LaneGroup step={3} label="研究确认后，四路一起写文案">
          <LaneCard
            avatarId="video-editor"
            name={resolveEmployeeDisplayName("video-editor", employeeNames)}
            status={videoSummary.pendingGeneration > 0 ? `待生成 ${videoSummary.pendingGeneration}` : "已完成"}
            href="/team/video-editor"
          />
          <LaneCard
            avatarId="xiaohongshu-editor"
            name={resolveEmployeeDisplayName("xiaohongshu-editor", employeeNames)}
            status={
              xiaohongshuSummary.pendingGeneration > 0 ? `待生成 ${xiaohongshuSummary.pendingGeneration}` : "已完成"
            }
            href="/team/xiaohongshu-editor"
          />
          <LaneCard
            avatarId="xiaohongshu-image-planner"
            name={resolveEmployeeDisplayName("xiaohongshu-image-planner", employeeNames)}
            status={xhsPagesPending > 0 ? `待生成 ${xhsPagesPending}` : "已完成"}
            href="/team/xiaohongshu-image-planner"
          />
          <LaneCard
            avatarId="wechat-editor"
            name={resolveEmployeeDisplayName("wechat-editor", employeeNames)}
            status={wechatSummary.pendingGeneration > 0 ? `待生成 ${wechatSummary.pendingGeneration}` : "已完成"}
            href="/team/wechat-editor"
          />
        </LaneGroup>

        <StageRow
          avatarId="image-designer"
          step={4}
          name={resolveEmployeeDisplayName("image-designer", employeeNames)}
          status={
            imagePendingCount > 0
              ? `待生成 ${imagePendingCount}`
              : contentImages.length > 0
                ? "已完成"
                : "空闲"
          }
          actionLabel="查看配图"
          href="/team/image-designer"
          kind="auto"
        />
        <StageRow
          avatarId="compliance"
          step={5}
          name={resolveEmployeeDisplayName("compliance", employeeNames)}
          status={complianceAttentionItems.length > 0 ? `有 ${complianceAttentionItems.length} 项需要确认` : "空闲"}
          actionLabel="查看合规"
          href="/team/compliance"
          kind="auto"
        />
        <StageRow
          avatarId="reviser"
          step={6}
          name={resolveEmployeeDisplayName("reviser", employeeNames)}
          status={needsRevisionItems.length > 0 ? `待修改 ${needsRevisionItems.length} 项` : "空闲"}
          actionLabel="查看修改"
          href="/team/reviser"
          kind="auto"
        />
        <StageRow
          avatarId="integrator"
          step={7}
          name={resolveEmployeeDisplayName("integrator", employeeNames)}
          status="查看最终成品"
          actionLabel="查看整合"
          href="/team/integrator"
          kind="auto"
        />
        <StageRow
          avatarId="analyst"
          step={9}
          name={resolveEmployeeDisplayName("analyst", employeeNames)}
          status={performanceCount > 0 ? `已有 ${performanceCount} 条数据` : "等待你上传数据"}
          actionLabel="查看数据"
          href="/team/analyst"
          kind="input"
          last
        />
      </section>
    </div>
  );
}

export default async function HomePage() {
  const demo = await isDemoMode();
  return <BossHome demo={demo} />;
}
