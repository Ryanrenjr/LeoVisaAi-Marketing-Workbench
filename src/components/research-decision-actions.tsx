import Link from "next/link";
import { researchDecisionTier } from "@/lib/ai/research-pack";
import { discardTopic } from "@/app/topics/actions";
import { PendingSubmitButton } from "./pending-submit-button";
import { Button } from "./ui/button";
import { OptimizeResearchButton, AcceptSuggestedTopicRevisionButton } from "./optimize-research-buttons";
import { ApproveResearchForm } from "./approve-research-form";
import type { SuggestedTopicRevision } from "@/lib/types";

/**
 * The one place "能不能直接做内容" turns into buttons — live product
 * instruction: a user should never need to understand score bands,
 * workflow states, or why a button isn't there; they should see the right
 * 2-3 actions for whatever this pack's score actually is. Shared between
 * the dedicated review page and the full topic detail page's 研究包 tab so
 * neither can drift into showing a button the backend gate (score >= 80,
 * see research-pack.ts's canApproveResearchScore / the approve_research
 * DB function) would silently reject.
 *
 * `canDecide` (通过/淘汰) and `canOptimize` (优化研究/修改选题) are separate
 * because they're genuinely different permissions in this app: approving
 * is EXPERT-or-ADMIN, running more of B's research is ADMIN-only (same
 * gate as the plain "运行研究" button) — see src/lib/permissions.ts.
 */
export function ResearchDecisionActions({
  topicId,
  researchPackId,
  scoreTotal,
  suggestedTopicRevision,
  currentTitle,
  currentAudience,
  canDecide,
  canOptimize,
}: {
  topicId: string;
  researchPackId: string;
  scoreTotal: number;
  suggestedTopicRevision: SuggestedTopicRevision | null;
  currentTitle: string;
  currentAudience: string;
  canDecide: boolean;
  canOptimize: boolean;
}) {
  if (!canDecide && !canOptimize) return null;

  // B's optimization pass concluded the evidence is fine but the topic's
  // own framing overstates it (RESULT 2, docs/ai-workflows.md "研究优化")
  // — this takes priority over the plain score-tier buttons below,
  // regardless of what the score itself is, since accepting or declining
  // the suggestion is the more specific decision in front of the user.
  if (suggestedTopicRevision) {
    return (
      <div className="card flex flex-col gap-3 px-5 py-4">
        <p className="text-base font-medium">当前问题不是研究不够，而是原选题表达超过了现有证据。</p>
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] px-3 py-2.5 text-sm">
          <div>
            <span className="text-[var(--muted)]">原选题：</span>
            {currentTitle}
          </div>
          <div className="text-[var(--muted)]">↓</div>
          <div>
            <span className="text-[var(--muted)]">建议选题：</span>
            {suggestedTopicRevision.title}
          </div>
          <div>
            <span className="text-[var(--muted)]">建议核心问题：</span>
            {suggestedTopicRevision.question}
          </div>
          {suggestedTopicRevision.audience && (
            <>
              <div>
                <span className="text-[var(--muted)]">原目标人群：</span>
                {currentAudience}
              </div>
              <div>
                <span className="text-[var(--muted)]">建议目标人群：</span>
                {suggestedTopicRevision.audience}
              </div>
            </>
          )}
          <div className="text-[var(--muted)]">为什么要改：{suggestedTopicRevision.reason}</div>
        </div>
        {canOptimize && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-[2]">
              <AcceptSuggestedTopicRevisionButton topicId={topicId} researchPackId={researchPackId} />
            </div>
            <div className="flex-1">
              <OptimizeResearchButton topicId={topicId} label="保留原标题继续研究" variant="secondary" />
            </div>
            {canDecide && (
              <form action={discardTopic.bind(null, topicId)} className="flex-1">
                <PendingSubmitButton variant="secondary" className="w-full">
                  淘汰
                </PendingSubmitButton>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  const tier = researchDecisionTier(scoreTotal);

  if (tier === "APPROVED" || tier === "APPROVED_WITH_CAUTION") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base font-medium">
          {tier === "APPROVED" ? "研究可靠，可以进入内容制作" : "基本可用，但制作时必须保留限定条件"}
        </p>
        {canDecide && (
          <div className="flex gap-3">
            <form action={discardTopic.bind(null, topicId)} className="flex-1">
              <PendingSubmitButton variant="secondary" className="w-full">
                淘汰
              </PendingSubmitButton>
            </form>
            <ApproveResearchForm topicId={topicId} researchPackId={researchPackId} />
          </div>
        )}
        {canOptimize && <OptimizeResearchButton topicId={topicId} label="继续优化研究" variant="secondary" />}
      </div>
    );
  }

  // RESEARCH_MORE (70-79) or REJECT (<70) — "通过，开始生成" is
  // deliberately not rendered as a normal clickable action here at all; a
  // click that somehow still reached approveResearchOnly would be silently
  // rejected server-side (canApproveResearchScore), but a user should never
  // see a button whose only job is to fail.
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-medium text-amber-700 dark:text-amber-400">
        {tier === "RESEARCH_MORE" ? "这份研究还不够完整，建议补充研究后再制作内容。" : "当前证据不足，不建议直接制作内容。"}
      </p>
      {canOptimize && <OptimizeResearchButton topicId={topicId} label="优化研究" />}
      <div className="flex gap-3">
        {canOptimize && (
          <Link href={`/topics/${topicId}/edit`} className="flex-1">
            <Button variant="secondary" className="w-full">
              修改选题
            </Button>
          </Link>
        )}
        {canDecide && (
          <form action={discardTopic.bind(null, topicId)} className="flex-1">
            <PendingSubmitButton variant="secondary" className="w-full">
              淘汰
            </PendingSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
