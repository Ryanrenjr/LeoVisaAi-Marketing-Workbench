import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLatestResearchPack, getResearchOptimizationCount, getResearchSources, getTopicById, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { canApproveResearch, canRunResearch } from "@/lib/permissions";
import { canApproveResearchFromStatus } from "@/lib/research-workflow";
import { ResearchPackView } from "@/components/research-pack-view";
import { ResearchDecisionActions } from "@/components/research-decision-actions";

/**
 * The dedicated, single-purpose approval screen — deliberately separate
 * from the full Topic Detail page. No tabs, no edit controls, no workflow-
 * state jargon: a user should be able to look at this page and know
 * exactly one thing — "这个研究现在能不能直接做内容？" — and see exactly the
 * 2-3 buttons that make sense for that answer. See
 * src/components/research-decision-actions.tsx for the score-tier button
 * logic (shared with the full topic detail page's 研究包 tab) and
 * src/components/research-pack-view.tsx for "研究诊断". Reuses
 * research-actions.ts unchanged apart from the new optimizeResearch /
 * acceptSuggestedTopicRevision actions — this is a presentation-layer
 * addition, same principle as Boss Mode. See docs/digital-employee-ux.md.
 */
export default async function ReviewResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [topic, demo, user] = await Promise.all([getTopicById(id), isDemoMode(), getCurrentUser()]);
  if (!topic) notFound();

  if (!demo) {
    if (!user) redirect("/login");
    if (!canApproveResearch(user.role) && !canRunResearch(user.role)) redirect(`/topics/${id}`);
  }

  const researchPack = await getLatestResearchPack(id);
  if (!researchPack) redirect(`/topics/${id}`);
  const [sources, optimizationCount] = await Promise.all([
    getResearchSources(researchPack.id),
    getResearchOptimizationCount(id),
  ]);

  const atDecisionStage = canApproveResearchFromStatus(topic.status);
  const canDecide = !demo && atDecisionStage && !!user && canApproveResearch(user.role);
  const canOptimize = !demo && atDecisionStage && !!user && canRunResearch(user.role);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <Link href={`/topics/${topic.id}`} className="text-xs text-[var(--muted)] hover:underline">
          ← 返回选题详情
        </Link>
        <h1 className="mt-2 text-lg font-semibold">审阅研究：{topic.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          B｜政策研究员已完成研究，请看看结果是否可用。
        </p>
        {optimizationCount > 0 && <p className="mt-1 text-xs text-[var(--muted)]">已优化 {optimizationCount} 次</p>}
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），审批已禁用。
        </p>
      )}

      <ResearchPackView pack={researchPack} sources={sources} topic={topic} />

      {atDecisionStage ? (
        <ResearchDecisionActions
          topicId={topic.id}
          researchPackId={researchPack.id}
          scoreTotal={researchPack.score_total ?? 0}
          suggestedTopicRevision={researchPack.suggested_topic_revision}
          currentTitle={topic.title}
          currentAudience={topic.audience}
          canDecide={canDecide}
          canOptimize={canOptimize}
        />
      ) : (
        <p className="text-sm text-[var(--muted)]">这个选题当前不在等待审批的状态。</p>
      )}
    </div>
  );
}
