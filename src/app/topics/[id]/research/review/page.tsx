import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLatestResearchPack, getResearchSources, getTopicById, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { canApproveResearch } from "@/lib/permissions";
import { canApproveResearchFromStatus } from "@/lib/research-workflow";
import { ResearchPackView } from "@/components/research-pack-view";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { PlatformChoiceRadios } from "@/components/platform-choice-radios";
import { discardTopic } from "../../../actions";
import { approveAndGoHome } from "../../../pipeline-actions";

/**
 * The dedicated, single-purpose approval screen — deliberately separate
 * from the full Topic Detail page. No tabs, no edit controls: just what's
 * needed to decide 批准/请求修改, plus the topic score (surfaced via
 * ResearchPackView's `topic` prop) since that's directly relevant to the
 * decision. Reuses ResearchPackView and the existing research-actions.ts
 * unchanged — this is a presentation-only addition, same principle as
 * Boss Mode. See docs/digital-employee-ux.md.
 */
export default async function ReviewResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [topic, demo, user] = await Promise.all([getTopicById(id), isDemoMode(), getCurrentUser()]);
  if (!topic) notFound();

  if (!demo) {
    if (!user) redirect("/login");
    if (!canApproveResearch(user.role)) redirect(`/topics/${id}`);
  }

  const researchPack = await getLatestResearchPack(id);
  if (!researchPack) redirect(`/topics/${id}`);
  const sources = await getResearchSources(researchPack.id);

  const canDecide = !demo && canApproveResearchFromStatus(topic.status);

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
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），审批已禁用。
        </p>
      )}

      <ResearchPackView pack={researchPack} sources={sources} topic={topic} />

      {canDecide ? (
        <div className="flex gap-3">
          <form action={discardTopic.bind(null, topic.id)} className="flex-1">
            <PendingSubmitButton variant="secondary" className="w-full">
              淘汰
            </PendingSubmitButton>
          </form>
          <form action={approveAndGoHome.bind(null, topic.id, researchPack.id)} className="flex flex-[2] flex-col gap-2">
            <PlatformChoiceRadios />
            <PendingSubmitButton className="w-full">通过，开始生成</PendingSubmitButton>
          </form>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">这个选题当前不在等待审批的状态。</p>
      )}
    </div>
  );
}
