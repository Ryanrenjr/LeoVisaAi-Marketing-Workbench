import type { Topic } from "@/lib/types";
import { StatusBadge } from "./status-badge";

export function TopicCard({
  topic,
  action,
}: {
  topic: Topic;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{topic.title}</p>
        {topic.question && (
          <p className="mt-0.5 text-sm text-[var(--muted)]">{topic.question}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <StatusBadge status={topic.status} />
          {topic.published_at && (
            <span className="text-xs text-[var(--muted)]">
              发布于 {new Date(topic.published_at).toLocaleDateString("zh-CN")}
            </span>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}
