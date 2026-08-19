"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { editResearchPack, type ResearchEditState } from "@/app/topics/research-actions";

const initialState: ResearchEditState = { error: null };

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

export function ResearchEditForm({
  topicId,
  packId,
  initial,
}: {
  topicId: string;
  packId: string;
  initial: { summary: string; keyFindings: string[]; warnings: string };
}) {
  const boundEdit = editResearchPack.bind(null, packId, topicId);
  const [state, formAction, pending] = useActionState(boundEdit, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        研究摘要
        <textarea
          name="summary"
          defaultValue={initial.summary}
          required
          rows={3}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        关键发现（每行一条）
        <textarea
          name="key_findings"
          defaultValue={initial.keyFindings.join("\n")}
          rows={5}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        注意事项
        <textarea name="warnings" defaultValue={initial.warnings} rows={2} className={inputClass} />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
        <Link href={`/topics/${topicId}`}>
          <Button type="button" variant="secondary">
            取消
          </Button>
        </Link>
      </div>
    </form>
  );
}
