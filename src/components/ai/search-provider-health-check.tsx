"use client";

import { useActionState } from "react";
import { Button } from "../ui/button";
import { runSearchProviderHealthCheck } from "@/app/admin/ai-models/health-actions";
import type { SearchHealthCheckResult } from "@/lib/search/search-health";
import type { SearchProviderId } from "@/lib/search/types";

const STATUS_LABEL: Record<SearchHealthCheckResult["status"], string> = {
  NOT_CONFIGURED: "未配置",
  SUCCESS: "成功",
  FAILED: "失败",
};

export function SearchProviderHealthCheck({ provider }: { provider: SearchProviderId }) {
  const [result, formAction, pending] = useActionState<SearchHealthCheckResult | null, FormData>(
    runSearchProviderHealthCheck,
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
          {result.resultCount !== null && ` · 返回结果数：${result.resultCount}`}
          {result.latencyMs !== null && ` · 延迟：${result.latencyMs}ms`}
          {result.error && ` · ${result.error}`}
        </p>
      )}
    </form>
  );
}
