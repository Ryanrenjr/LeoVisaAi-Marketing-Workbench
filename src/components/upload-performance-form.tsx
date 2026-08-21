"use client";

import { useActionState, useState } from "react";
import { uploadPerformanceScreenshot } from "@/app/team/analyst/actions";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { PRICING_LABEL } from "@/lib/ai/providers/types";
import { Button } from "./ui/button";
import { ThinkingRow } from "./ai/thinking-row";
import { getEmployee } from "@/lib/boss-language";
import type { OverridableModel } from "./ai/generate-action";
import type { ContentPlatform, Topic } from "@/lib/types";

const inputClass = "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

const PLATFORMS = Object.entries(CONTENT_PLATFORM_LABEL) as [ContentPlatform, string][];

export interface UploadModelOptions {
  models: OverridableModel[];
  defaultModel: OverridableModel | null;
  resolutionError: string | null;
}

function modelKey(m: Pick<OverridableModel, "provider" | "modelId">) {
  return `${m.provider}::${m.modelId}`;
}

export function UploadPerformanceForm({
  publishedTopics,
  modelOptions,
}: {
  publishedTopics: Topic[];
  modelOptions: UploadModelOptions | null;
}) {
  const [state, formAction, pending] = useActionState(uploadPerformanceScreenshot, { error: null });
  const [selectedKey, setSelectedKey] = useState("");
  const [confirming, setConfirming] = useState(false);

  const selected = selectedKey ? (modelOptions?.models.find((m) => modelKey(m) === selectedKey) ?? null) : null;
  const effective = selected ?? modelOptions?.defaultModel ?? null;
  const needsWarning = effective ? effective.pricingType === "PAID" || effective.pricingType === "MIXED" : false;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (needsWarning && !confirming) {
          e.preventDefault();
          setConfirming(true);
        }
      }}
      className="flex flex-col gap-4 rounded-md border border-[var(--border)] px-4 py-3"
    >
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

      {modelOptions && (
        <div className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          {effective ? (
            <span>
              当前模型：{effective.displayName} · {PRICING_LABEL[effective.pricingType]}
              {!effective.configured && "（未配置）"}
            </span>
          ) : (
            <span>{modelOptions.resolutionError ?? "尚未配置可用模型。"}</span>
          )}
          {modelOptions.models.length > 1 && (
            <select
              name="modelKey"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className={inputClass}
            >
              <option value="">
                使用默认模型{modelOptions.defaultModel ? `（${modelOptions.defaultModel.displayName}）` : ""}
              </option>
              {modelOptions.models.map((m) => (
                <option key={modelKey(m)} value={modelKey(m)}>
                  {m.displayName} · {PRICING_LABEL[m.pricingType]}
                  {!m.configured ? "（未配置）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {confirming && effective && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm">
          <p>此任务将调用可能产生费用的 AI 模型。</p>
          <p className="text-xs text-[var(--muted)]">
            供应商：{effective.provider} · 模型：{effective.displayName}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button type="submit">继续上传</Button>
          </div>
        </div>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      {pending ? (
        <ThinkingRow avatarId="analyst" name={getEmployee("analyst").name} />
      ) : (
        !confirming && (
          <Button type="submit" className="w-full py-4 text-base">
            上传并分析
          </Button>
        )
      )}
    </form>
  );
}
