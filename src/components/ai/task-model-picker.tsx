"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "../ui/button";
import { setTaskModelDefault } from "@/app/admin/actions";
import { runModelHealthCheck } from "@/app/admin/ai-models/health-actions";
import type { HealthCheckResult } from "@/lib/ai/provider-health";
import type { TaskType } from "@/lib/ai/providers/types";

const STATUS_LABEL: Record<HealthCheckResult["status"], string> = {
  NOT_CONFIGURED: "未配置",
  SUCCESS: "成功",
  FAILED: "失败",
};

/**
 * One task's model dropdown ("一选就生效" — unchanged) plus a "测试这个
 * 模型" button that pings the EXACT model currently selected, not a
 * stand-in "lightest model for this provider" — see
 * provider-health.ts checkModelHealth. Live user instruction: "加一个测试
 * 按钮，测试每个模型是否真的可以用。"
 */
export function TaskModelPicker({
  taskType,
  defaultValue,
  options,
}: {
  taskType: TaskType;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(defaultValue);
  const [result, testAction, pending] = useActionState<HealthCheckResult | null, FormData>(
    runModelHealthCheck,
    null,
  );

  const [provider, modelId] = selected ? selected.split("::") : ["", ""];

  return (
    <div className="flex flex-col gap-2">
      <form ref={formRef} action={setTaskModelDefault}>
        <input type="hidden" name="taskType" value={taskType} />
        <select
          name="modelChoice"
          defaultValue={defaultValue}
          onChange={(e) => {
            setSelected(e.target.value);
            formRef.current?.requestSubmit();
          }}
          className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </form>

      <form action={testAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="provider" value={provider ?? ""} />
        <input type="hidden" name="modelId" value={modelId ?? ""} />
        <Button type="submit" variant="secondary" disabled={pending || !provider || !modelId} className="text-sm">
          {pending ? "测试中…" : "测试这个模型"}
        </Button>
        {!provider || !modelId ? (
          <span className="text-xs text-[var(--muted)]">先在上面选一个具体模型才能测试</span>
        ) : (
          result && (
            <span className="text-xs text-[var(--muted)]">
              {STATUS_LABEL[result.status]}
              {result.latencyMs !== null && ` · ${result.latencyMs}ms`}
              {(result.inputTokens !== null || result.outputTokens !== null) &&
                ` · tokens：${result.inputTokens ?? "—"}/${result.outputTokens ?? "—"}`}
              {result.error && ` · ${result.error}`}
            </span>
          )
        )}
      </form>
    </div>
  );
}
