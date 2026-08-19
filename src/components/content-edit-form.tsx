"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { editContentAsset, type ContentEditState } from "@/app/topics/content-actions";

const initialState: ContentEditState = { error: null };

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

export function ContentEditForm({
  topicId,
  assetId,
  initial,
}: {
  topicId: string;
  assetId: string;
  initial: { title: string; content: string };
}) {
  const boundEdit = editContentAsset.bind(null, assetId, topicId);
  const [state, formAction, pending] = useActionState(boundEdit, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        标题
        <input name="title" defaultValue={initial.title} required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        正文
        <textarea name="content" defaultValue={initial.content} required rows={16} className={inputClass} />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存为新版本"}
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
