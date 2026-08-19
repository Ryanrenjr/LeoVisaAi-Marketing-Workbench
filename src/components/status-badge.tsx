import { STATUS_LABEL } from "@/lib/status";
import type { TopicStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: TopicStatus }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
      {STATUS_LABEL[status]}
    </span>
  );
}
