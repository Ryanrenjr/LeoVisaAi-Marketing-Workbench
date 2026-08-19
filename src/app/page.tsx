import Link from "next/link";
import {
  getAllContentAssets,
  getAllTopics,
  getLibraryTopics,
  getStageCounts,
  isDemoMode,
} from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentViewMode } from "@/lib/get-current-view-mode";
import { PIPELINE_STAGES } from "@/lib/status";
import { timeBasedGreeting } from "@/lib/boss-language";
import {
  buildLeoReviewQueue,
  filterContentEligibleTopics,
  summarizeEditorTasks,
  summarizePlannerTasks,
  summarizeResearcherTasks,
} from "@/lib/employee-tasks";
import { groupContentAssetsByTopicId } from "@/lib/content-versions";
import { EmployeeCard } from "@/components/employee-card";
import { Button } from "@/components/ui/button";

function DemoNotice() {
  return (
    <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
      当前为演示数据（未连接 Supabase）。配置 .env.local 后将显示真实数据。
    </p>
  );
}

/** Unchanged from before this milestone — the operational dashboard for Admin Mode. */
async function AdminHome({ demo }: { demo: boolean }) {
  const counts = await getStageCounts();
  const libraryCount = counts.IDEA + counts.RESEARCHING + counts.RESEARCH_READY;

  return (
    <div className="flex flex-col gap-10">
      {demo && <DemoNotice />}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Link
          href="/topics"
          className="rounded-md border border-[var(--border)] px-4 py-3 hover:bg-[var(--border)]/20"
        >
          <p className="text-sm text-[var(--muted)]">选题库</p>
          <p className="mt-1 text-2xl font-semibold">{libraryCount}</p>
        </Link>
        {PIPELINE_STAGES.map((stage) => (
          <Link
            key={stage.status}
            href={stage.href}
            className="rounded-md border border-[var(--border)] px-4 py-3 hover:bg-[var(--border)]/20"
          >
            <p className="text-sm text-[var(--muted)]">{stage.label}</p>
            <p className="mt-1 text-2xl font-semibold">{counts[stage.status]}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

async function BossHome({ demo }: { demo: boolean }) {
  const user = await getCurrentUser();
  const [libraryTopics, allTopics, allContentAssets] = await Promise.all([
    getLibraryTopics(),
    getAllTopics(),
    getAllContentAssets(),
  ]);

  const contentAssetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  const eligibleTopics = filterContentEligibleTopics(allTopics);

  const plannerSummary = summarizePlannerTasks(libraryTopics);
  const researcherSummary = summarizeResearcherTasks(libraryTopics);
  const editorSummary = summarizeEditorTasks(eligibleTopics, contentAssetsByTopicId);
  const reviewQueue = buildLeoReviewQueue(allTopics, contentAssetsByTopicId);
  const researchReviewCount = reviewQueue.filter((i) => i.employeeId === "researcher").length;
  const contentReviewCount = reviewQueue.filter((i) => i.employeeId === "editor").length;
  const totalPending = researchReviewCount + contentReviewCount;

  const greeting = timeBasedGreeting(new Date().getHours());
  const name = user?.displayName ?? "老板";

  return (
    <div className="flex flex-col gap-10">
      {demo && <DemoNotice />}

      <section>
        <h1 className="text-lg font-semibold">
          {greeting}，{name}。
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">你的数字团队正在工作。</p>

        {totalPending > 0 ? (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
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
            letter="A"
            name="选题策划员"
            status={plannerSummary.todayCandidates > 0 ? "工作中" : "空闲"}
            responsibility="帮你决定今天最值得做什么内容。"
            stats={[
              { label: "今日候选", value: plannerSummary.todayCandidates },
              { label: "高优先级", value: plannerSummary.highPriority },
            ]}
            actionLabel="查看选题"
            href="/team/planner"
          />
          <EmployeeCard
            letter="B"
            name="政策研究员"
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
            letter="C"
            name="内容编辑"
            status={
              editorSummary.pendingGeneration > 0
                ? "工作中"
                : editorSummary.draftsComplete > 0
                  ? "已完成"
                  : "空闲"
            }
            responsibility="把研究变成视频号、小红书和公众号。"
            stats={[
              { label: "待生成", value: editorSummary.pendingGeneration },
              { label: "草稿完成", value: editorSummary.draftsComplete },
            ]}
            actionLabel="查看内容"
            href="/team/editor"
          />
          <EmployeeCard
            letter="D"
            name="合规审核员"
            status="尚未启用"
            responsibility="专门挑错，不负责写稿。"
            stats={[]}
            actionLabel="即将上线"
            href="/team/compliance"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
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
    </div>
  );
}

export default async function HomePage() {
  const [mode, demo] = await Promise.all([getCurrentViewMode(), isDemoMode()]);
  return mode === "admin" ? <AdminHome demo={demo} /> : <BossHome demo={demo} />;
}
