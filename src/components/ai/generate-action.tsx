"use client";

import { useState, useTransition } from "react";
import { Button } from "../ui/button";
import type { AIProviderId, PricingType, TaskType } from "@/lib/ai/providers/types";
import { PRICING_LABEL } from "@/lib/ai/providers/types";

/**
 * The one place PAID/MIXED warning UX (spec section 7) and the task-level
 * temporary model override (spec section 9) live — reused by every
 * ADMIN-only "生成"/"运行研究" button on the Topic Detail page. Boss Mode
 * never renders this component; model selection stays an ADMIN concern.
 */

export interface OverridableModel {
  provider: AIProviderId;
  modelId: string;
  displayName: string;
  pricingType: PricingType;
  configured: boolean;
}

export interface GenerateActionProps {
  action: (override: { provider: AIProviderId; modelId: string } | null) => Promise<void>;
  label: string;
  taskType: TaskType;
  variant?: "primary" | "secondary";
  models: OverridableModel[];
  defaultModel: OverridableModel | null;
  resolutionError: string | null;
}

function modelKey(m: Pick<OverridableModel, "provider" | "modelId">) {
  return `${m.provider}::${m.modelId}`;
}

export function GenerateAction({
  action,
  label,
  variant = "primary",
  models,
  defaultModel,
  resolutionError,
}: GenerateActionProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = selectedKey ? (models.find((m) => modelKey(m) === selectedKey) ?? null) : null;
  const effective = selected ?? defaultModel;
  const needsWarning = effective ? effective.pricingType === "PAID" || effective.pricingType === "MIXED" : false;

  function run() {
    const override = selected ? { provider: selected.provider, modelId: selected.modelId } : null;
    startTransition(async () => {
      await action(override);
      setConfirming(false);
    });
  }

  function handleSubmit() {
    if (!effective) return;
    if (needsWarning && !confirming) {
      setConfirming(true);
      return;
    }
    run();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        {effective ? (
          <span>
            当前模型：{effective.displayName} · {PRICING_LABEL[effective.pricingType]}
            {!effective.configured && "（未配置）"}
          </span>
        ) : (
          <span>{resolutionError ?? "尚未配置可用模型。"}</span>
        )}
        {models.length > 1 && (
          <button
            type="button"
            className="cursor-pointer underline-offset-2 hover:underline"
            onClick={() => setShowPicker((v) => !v)}
          >
            更换本次模型
          </button>
        )}
      </div>

      {showPicker && (
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="w-fit rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        >
          <option value="">使用默认模型{defaultModel ? `（${defaultModel.displayName}）` : ""}</option>
          {models.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)}>
              {m.displayName} · {PRICING_LABEL[m.pricingType]}
              {!m.configured ? "（未配置）" : ""}
            </option>
          ))}
        </select>
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
            <Button type="button" onClick={run} disabled={pending}>
              继续运行
            </Button>
          </div>
        </div>
      )}

      {!confirming && (
        <div>
          <Button type="button" variant={variant} disabled={!effective || pending} onClick={handleSubmit}>
            {pending ? "处理中…" : label}
          </Button>
        </div>
      )}
    </div>
  );
}
