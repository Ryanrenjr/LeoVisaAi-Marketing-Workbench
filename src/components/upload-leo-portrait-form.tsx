"use client";

import { useActionState } from "react";
import { uploadLeoPortrait } from "@/app/team/image-designer/actions";
import { Button } from "./ui/button";

const inputClass = "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

/** ADMIN-only upload form for a real photo of Leo — see docs/security-boundaries.md for why this upload surface exists at all. */
export function UploadLeoPortraitForm() {
  const [state, formAction, pending] = useActionState(uploadLeoPortrait, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
      <label className="flex flex-col gap-1 text-sm">
        照片
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        备注（可选）
        <input name="label" type="text" placeholder="例如：正装半身照" className={inputClass} />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "上传中…" : "上传照片"}
      </Button>
    </form>
  );
}
