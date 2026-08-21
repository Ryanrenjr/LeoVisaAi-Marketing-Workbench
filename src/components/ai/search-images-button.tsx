"use client";

import { useState, useTransition } from "react";
import { Button } from "../ui/button";
import { ThinkingRow } from "./thinking-row";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * "搜索配图" trigger for video-editor/wechat-editor — no AI model to pick
 * (Google Image Search only, see src/lib/search/image-router.ts), so this
 * is a plain button + ThinkingRow rather than GenerateAction's model-
 * picker/PAID-confirmation machinery, which doesn't apply here.
 */
export function SearchImagesButton({
  action,
  avatarId,
  employeeName,
  label,
}: {
  action: () => Promise<{ ok: boolean; error?: string }>;
  avatarId: EmployeeId;
  employeeName: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (pending) return <ThinkingRow avatarId={avatarId} name={employeeName} />;

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        className="text-sm"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            if (!result.ok) setError(result.error ?? "搜索失败。");
          })
        }
      >
        {label}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
