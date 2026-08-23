import Image from "next/image";
import Link from "next/link";
import {
  getAllComplianceReviews,
  getAllContentAssets,
  getAllTopics,
  getLibraryTopics,
  getStageCounts,
  isDemoMode,
} from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentViewMode } from "@/lib/get-current-view-mode";
import { PIPELINE_STAGES } from "@/lib/status";
import { timeBasedGreeting, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { getRecentPublishPerformanceCount } from "@/lib/analytics";
import { getAllContentImages } from "@/lib/content-images";
import {
  buildComplianceQueue,
  buildHomeSpotlight,
  buildLeoReviewQueue,
  filterContentEligibleTopics,
  summarizeEditorTasks,
  summarizePlannerTasks,
  summarizeResearcherTasks,
} from "@/lib/employee-tasks";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { Button } from "@/components/ui/button";
import { GateNote, LaneCard, LaneGroup, LoopBackNote, ManualNote, StageRow } from "@/components/pipeline-flow";
import type { ComplianceReviewRow } from "@/lib/types";

function DemoNotice() {
  return (
    <p className="card px-4 py-3 text-sm text-[var(--muted)]">
      当前为演示数据（未连接 Supabase）。配置 .env.local 后将显示真实数据。
    </p>
  );
}

/**
 * ADMIN-only, collapsed: the pipeline-stage pages (选题库/可进入拍摄/本周已发布/
 * 内容资产库) that aren't any digital employee's job — Leo shoots and
 * publishes by hand. Live user instruction: Admin Mode's home should be
 * the same employee-card view as Boss Mode, so this is tucked away rather
 * than a permanent 8-item nav bar (see src/components/nav.tsx).
 */
async function OperationalLinks() {
  const counts = await getStageCounts();
  const libraryCount = counts.IDEA + counts.RESEARCHING + counts.RESEARCH_READY;

  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-[var(--muted)]">运营列表</summary>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Link href="/topics" className="card px-4 py-3 hover:border-[var(--accent)]/40">
          <p className="text-sm text-[var(--muted)]">选题库</p>
          <p className="mt-1 text-2xl font-semibold">{libraryCount}</p>
        </Link>
        {PIPELINE_STAGES.map((stage) => (
          <Link key={stage.status} href={stage.href} className="card px-4 py-3 hover:border-[var(--accent)]/40">
            <p className="text-sm text-[var(--muted)]">{stage.label}</p>
            <p className="mt-1 text-2xl font-semibold">{counts[stage.status]}</p>
          </Link>
        ))}
        <Link href="/content-assets" className="card px-4 py-3 hover:border-[var(--accent)]/40">
          <p className="text-sm text-[var(--muted)]">内容资产库</p>
          <p className="mt-1 text-sm text-[var(--muted)]">查看全部版本</p>
        </Link>
      </div>
    </details>
  );
}

async function BossHome({ demo, isAdmin }: { demo: boolean; isAdmin: boolean }) {
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
  const reviewQueue = buildLeoReviewQueue(allTopics, contentAssetsByTopicId, new Map(), employeeNames);
  const researchReviewCount = reviewQueue.filter((i) => i.employeeId === "researcher").length;
  const contentReviewCount = reviewQueue.filter((i) => i.employeeId !== "researcher").length;
  const complianceAttentionItems = complianceQueue.filter(
    (item) => !item.latestReview || item.latestReview.overall_risk !== "LOW",
  );
  const totalPending = researchReviewCount + contentReviewCount + complianceAttentionItems.length;

  const xiaohongshuDraftTopicIds = eligibleTopics
    .filter((t) => getLatestForLineage(contentAssetsByTopicId.get(t.id) ?? [], "XIAOHONGSHU", "xiaohongshu_post"))
    .map((t) => t.id);
  const topicsWithImages = new Set(contentImages.map((img) => img.topic_id));
  const imagePendingCount = xiaohongshuDraftTopicIds.filter((id) => !topicsWithImages.has(id)).length;

  const spotlight = buildHomeSpotlight(reviewQueue, complianceAttentionItems, plannerSummary, employeeNames);

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

      <section className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-[var(--muted)]">现在该做什么</p>
        {spotlight ? (
          <Link href={spotlight.href} className="card flex items-center gap-4 px-5 py-4 hover:border-[var(--accent)]/40">
            <Image
              src={`/employees/${spotlight.employeeId}.png`}
              alt=""
              width={52}
              height={52}
              className="h-[52px] w-[52px] shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{spotlight.title}</p>
              <p className="truncate text-sm text-[var(--muted)]">{spotlight.subtitle}</p>
            </div>
            <Button className="shrink-0">{spotlight.actionLabel} →</Button>
          </Link>
        ) : (
          <p className="card px-5 py-4 text-sm text-[var(--muted)]">暂时没有需要你处理的事项。</p>
        )}
        {totalPending > 1 && (
          <Link href="/review" className="self-start text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
            还有 {totalPending - 1} 项待处理 →
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-[var(--muted)]">工作流程 · 共 7 步</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          绿色&ldquo;AI 一键产出&rdquo;点一下就出结果；灰色&ldquo;⏸ 需要你看一眼&rdquo;是必须你决定的地方。
        </p>

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
        <GateNote text="等你确认研究结论——这一步必须是人点头，App 里写死的规则" />

        <LaneGroup step={3} label="研究确认后，三路一起写文案">
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
        <GateNote text="等你看一眼合规结果——发不发、要不要改，你来定" />

        <ManualNote step={6} text="拍摄 + 发布 —— 这两步一直是你自己手动做的，AI 不插手，故意的" />

        <StageRow
          avatarId="analyst"
          step={7}
          name={resolveEmployeeDisplayName("analyst", employeeNames)}
          status={performanceCount > 0 ? `已有 ${performanceCount} 条数据` : "等待你上传数据"}
          actionLabel="查看数据"
          href="/team/analyst"
          kind="input"
          last
        />

        <LoopBackNote text="表现好的选题方向，下次会出现在选题策划员的参考里" />
      </section>

      {isAdmin && <OperationalLinks />}
    </div>
  );
}

export default async function HomePage() {
  const [mode, demo] = await Promise.all([getCurrentViewMode(), isDemoMode()]);
  return <BossHome demo={demo} isAdmin={mode === "admin"} />;
}
