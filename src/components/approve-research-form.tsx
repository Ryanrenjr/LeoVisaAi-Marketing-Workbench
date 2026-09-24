"use client";

import { useActionState } from "react";
import { approveAndGoHome } from "@/app/topics/pipeline-actions";
import { PendingSubmitButton } from "./pending-submit-button";
import { PlatformChoiceRadios } from "./platform-choice-radios";

const INITIAL_STATE = { error: null };

export function ApproveResearchForm({ topicId, researchPackId }: { topicId: string; researchPackId: string }) {
  const action = approveAndGoHome.bind(null, topicId, researchPackId);
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-[2] flex-col gap-2">
      <PlatformChoiceRadios />
      <PendingSubmitButton className="w-full">通过，开始生成</PendingSubmitButton>
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
