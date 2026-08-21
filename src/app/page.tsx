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
  buildLeoReviewQueue,
  filterContentEligibleTopics,
  summarizeEditorTasks,
  summarizePlannerTasks,
  summarizeResearcherTasks,
} from "@/lib/employee-tasks";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { EmployeeCard } from "@/components/employee-card";
import { Button } from "@/components/ui/button";
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
  const complianceNeedsAttention = complianceQueue.filter(
    (item) => !item.latestReview || item.latestReview.overall_risk !== "LOW",
  ).length;

  const plannerSummary = summarizePlannerTasks(libraryTopics);
  const researcherSummary = summarizeResearcherTasks(libraryTopics);
  const videoSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "VIDEO_CHANNEL");
  const xiaohongshuSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "XIAOHONGSHU");
  const wechatSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId, "WECHAT_OFFICIAL_ACCOUNT");
  const reviewQueue = buildLeoReviewQueue(allTopics, contentAssetsByTopicId, new Map(), employeeNames);
  const researchReviewCount = reviewQueue.filter((i) => i.employeeId === "researcher").length;
  const contentReviewCount = reviewQueue.filter((i) => i.employeeId !== "researcher").length;
  const totalPending = researchReviewCount + contentReviewCount;

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

      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}，{name}。
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">你的数字团队正在工作。</p>

        {totalPending > 0 ? (
          <div className="card mt-4 flex flex-col gap-3 px-5 py-4">
            <div className="text-sm">
              <p>今天需要你处理：</p>
              {researchReviewCount > 0 && <p className="mt-1">{researchReviewCount} 项等待审核</p>}
              {contentReviewCount > 0 && <p className="mt-1">{contentReviewCount} 项需要专业判断</p>}
            </div>
            <div>
              <Link href="/review">
                <Button>开始处理</Button>
              </Link>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">暂时没有需要你处理的事项。</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-[var(--muted)]">你的数字员工</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EmployeeCard
            avatarId="planner"
            letter="A"
            name={resolveEmployeeDisplayName("planner", employeeNames)}
            status={plannerSummary.todayCandidates > 0 ? "工作中" : "空闲"}
            responsibility="帮你决定今天最值得做什么内容，还能主动搜今天的新闻找选题。"
            stats={[
              { label: "今日候选", value: plannerSummary.todayCandidates },
              { label: "高优先级", value: plannerSummary.highPriority },
            ]}
            actionLabel="查看选题"
            href="/team/planner"
          />
          <EmployeeCard
            avatarId="researcher"
            letter="B"
            name={resolveEmployeeDisplayName("researcher", employeeNames)}
            status={
              researcherSummary.awaitingReview > 0
                ? "等你确认"
                : researcherSummary.inProgress > 0
                  ? "工作中"
                  : "空闲"
            }
            responsibility="帮你查官方规则、找依据、整理结论。"
            stats={[
              { label: "研究中", value: researcherSummary.inProgress },
              { label: "等待你审核", value: researcherSummary.awaitingReview },
            ]}
            actionLabel="查看研究"
            href="/team/researcher"
          />
          <EmployeeCard
            avatarId="video-editor"
            letter="C"
            name={resolveEmployeeDisplayName("video-editor", employeeNames)}
            status={
              videoSummary.pendingGeneration > 0
                ? "工作中"
                : videoSummary.draftsComplete > 0
                  ? "已完成"
                  : "空闲"
            }
            responsibility="把研究变成视频号口播文案。"
            stats={[
              { label: "待生成", value: videoSummary.pendingGeneration },
              { label: "草稿完成", value: videoSummary.draftsComplete },
            ]}
            actionLabel="查看内容"
            href="/team/video-editor"
          />
          <EmployeeCard
            avatarId="xiaohongshu-editor"
            letter="D"
            name={resolveEmployeeDisplayName("xiaohongshu-editor", employeeNames)}
            status={
              xiaohongshuSummary.pendingGeneration > 0
                ? "工作中"
                : xiaohongshuSummary.draftsComplete > 0
                  ? "已完成"
                  : "空闲"
            }
            responsibility="把研究变成小红书攻略文字。"
            stats={[
              { label: "待生成", value: xiaohongshuSummary.pendingGeneration },
              { label: "草稿完成", value: xiaohongshuSummary.draftsComplete },
            ]}
            actionLabel="查看内容"
            href="/team/xiaohongshu-editor"
          />
          <EmployeeCard
            avatarId="image-designer"
            letter="E"
            name={resolveEmployeeDisplayName("image-designer", employeeNames)}
            status={imagePendingCount > 0 ? "工作中" : contentImages.length > 0 ? "已完成" : "空闲"}
            responsibility="根据小红书文案生成配图。"
            stats={[
              { label: "待生成", value: imagePendingCount },
              { label: "已生成", value: contentImages.length },
            ]}
            actionLabel="查看配图"
            href="/team/image-designer"
          />
          <EmployeeCard
            avatarId="wechat-editor"
            letter="F"
            name={resolveEmployeeDisplayName("wechat-editor", employeeNames)}
            status={
              wechatSummary.pendingGeneration > 0
                ? "工作中"
                : wechatSummary.draftsComplete > 0
                  ? "已完成"
                  : "空闲"
            }
            responsibility="把研究变成公众号大纲和完整文章。"
            stats={[
              { label: "待生成", value: wechatSummary.pendingGeneration },
              { label: "草稿完成", value: wechatSummary.draftsComplete },
            ]}
            actionLabel="查看内容"
            href="/team/wechat-editor"
          />
          <EmployeeCard
            avatarId="compliance"
            letter="G"
            name={resolveEmployeeDisplayName("compliance", employeeNames)}
            status={complianceNeedsAttention > 0 ? "有内容需要确认" : "空闲"}
            responsibility="重新核对内容有没有超出研究依据、有没有风险用语。"
            stats={[{ label: "需要确认", value: complianceNeedsAttention }]}
            actionLabel="查看合规"
            href="/team/compliance"
          />
          <EmployeeCard
            avatarId="analyst"
            letter="H"
            name={resolveEmployeeDisplayName("analyst", employeeNames)}
            status={performanceCount > 0 ? "已有数据" : "等待数据"}
            responsibility="看发布后的数据表现，帮你判断下次该往哪个方向选题。"
            stats={[{ label: "已上传数据", value: performanceCount }]}
            actionLabel="查看数据"
            href="/team/analyst"
          />
        </div>
      </section>

      <section className="card flex flex-col gap-3 px-5 py-4">
        <h2 className="text-sm font-medium">Leo 待处理</h2>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--muted)]">等待研究确认</dt>
            <dd className="font-medium">{researchReviewCount}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[var(--muted)]">等待内容决定</dt>
            <dd className="font-medium">{contentReviewCount}</dd>
          </div>
        </dl>
        <div>
          <Link href="/review">
            <Button variant="secondary">开始审核</Button>
          </Link>
        </div>
      </section>

      {isAdmin && <OperationalLinks />}
    </div>
  );
}

export default async function HomePage() {
  const [mode, demo] = await Promise.all([getCurrentViewMode(), isDemoMode()]);
  return <BossHome demo={demo} isAdmin={mode === "admin"} />;
}
