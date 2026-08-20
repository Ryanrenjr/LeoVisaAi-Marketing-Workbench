"use client";

import { useActionState } from "react";
import { Button } from "../ui/button";
import { runProviderHealthCheck } from "@/app/admin/ai-models/health-actions";
import type { HealthCheckResult } from "@/lib/ai/provider-health";
import type { AIProviderId } from "@/lib/ai/providers/types";

const STATUS_LABEL: Record<HealthCheckResult["status"], string> = {
  NOT_CONFIGURED: "未配置",
  SUCCESS: "成功",
  FAILED: "失败",
};

export function ProviderHealthCheck({ provider }: { provider: AIProviderId }) {
  const [result, formAction, pending] = useActionState<HealthCheckResult | null, FormData>(
    runProviderHealthCheck,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "检查中…" : `健康检查：${provider}`}
        </Button>
      </div>
      {result && (
        <p className="text-xs text-[var(--muted)]">
          状态：{STATUS_LABEL[result.status]}
          {result.modelId && ` · 模型：${result.modelId}`}
          {result.latencyMs !== null && ` · 延迟：${result.latencyMs}ms`}
          {(result.inputTokens !== null || result.outputTokens !== null) &&
            ` · tokens：${result.inputTokens ?? "—"}/${result.outputTokens ?? "—"}`}
          {result.error && ` · ${result.error}`}
        </p>
      )}
    </form>
  );
}
