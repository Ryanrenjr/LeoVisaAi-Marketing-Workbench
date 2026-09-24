"use client";

import { useActionState } from "react";
import { optimizeResearchAction, acceptSuggestedTopicRevisionAction } from "@/app/topics/research-actions";
import type { OptimizeActionState } from "@/app/topics/research-actions";
import { PendingSubmitButton } from "./pending-submit-button";
import { ThinkingRow } from "./ai/thinking-row";

const INITIAL_STATE: OptimizeActionState = { ok: true };

const OPTIMIZING_LABEL = "B｜政策研究员正在针对当前研究的问题继续补充资料…";

/**
 * `useActionState`-backed forms for "优化研究" / "采用建议并重新研究" — same
 * pattern ResearchEditForm already establishes for editResearchPack. Live
 * product instruction: a failed optimization (most commonly: no search
 * provider currently available — see research-actions.ts's
 * RESEARCH_OPTIMIZATION_UNAVAILABLE_MESSAGE) must show the operator a
 * plain-language reason, not silently do nothing — the previous plain
 * `<form action={fn.bind(...)}>` discarded the action's return value
 * entirely, so a failure looked identical to nothing having happened.
 */
export function OptimizeResearchButton({
  topicId,
  label,
  variant = "primary",
  className = "w-full",
}: {
  topicId: string;
  label: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [state, formAction] = useActionState(optimizeResearchAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="topicId" value={topicId} />
      <PendingSubmitButton
        variant={variant}
        className={className}
        pendingLabel={OPTIMIZING_LABEL}
        pendingContent={<ThinkingRow avatarId="researcher" name="政策研究员" />}
      >
        {label}
      </PendingSubmitButton>
      {!state.ok && state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}

export function AcceptSuggestedTopicRevisionButton({
  topicId,
  researchPackId,
  className = "w-full",
}: {
  topicId: string;
  researchPackId: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(acceptSuggestedTopicRevisionAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="topicId" value={topicId} />
      <input type="hidden" name="researchPackId" value={researchPackId} />
      <PendingSubmitButton
        className={className}
        pendingLabel={OPTIMIZING_LABEL}
        pendingContent={<ThinkingRow avatarId="researcher" name="政策研究员" />}
      >
        采用建议并重新研究
      </PendingSubmitButton>
      {!state.ok && state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
