"use client";

import { useActionState } from "react";
import { uploadPerformanceScreenshot } from "@/app/team/analyst/actions";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { Button } from "./ui/button";
import type { ContentPlatform, Topic } from "@/lib/types";

const inputClass = "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

const PLATFORMS = Object.entries(CONTENT_PLATFORM_LABEL) as [ContentPlatform, string][];

export function UploadPerformanceForm({ publishedTopics }: { publishedTopics: Topic[] }) {
  const [state, formAction, pending] = useActionState(uploadPerformanceScreenshot, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-[var(--border)] px-4 py-3">
      <label className="flex flex-col gap-1 text-sm">
        选题
        <select name="topicId" required className={inputClass}>
          <option value="">请选择</option>
          {publishedTopics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} {t.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        平台
        <select name="platform" required className={inputClass}>
          <option value="">请选择</option>
          {PLATFORMS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        发布数据截图（阅读量/点赞/评论这类公开运营数据，不要上传其他内容）
        <input
          name="screenshot"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          required
          className={inputClass}
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "读取中…" : "上传并分析"}
        </Button>
      </div>
    </form>
  );
}
