import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLatestResearchPack, getResearchSources, getTopicById, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { canApproveResearch } from "@/lib/permissions";
import { canApproveResearchFromStatus } from "@/lib/research-workflow";
import { ResearchPackView } from "@/components/research-pack-view";
import { Button } from "@/components/ui/button";
import { approveResearch, requestResearchChanges } from "../../../research-actions";

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
        <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-4">
          <p className="text-sm font-medium">你的决定</p>
          <form action={approveResearch.bind(null, topic.id, researchPack.id)}>
            <Button type="submit" className="w-full sm:w-auto">
              批准研究
            </Button>
          </form>
          <form
            action={requestResearchChanges.bind(null, topic.id, researchPack.id)}
            className="flex flex-col gap-2"
          >
            <textarea
              name="note"
              placeholder="需要修改的地方（可选，留空也可以提交）"
              rows={2}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
            <div>
              <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                请求修改
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">这个选题当前不在等待审批的状态。</p>
      )}
    </div>
  );
}
