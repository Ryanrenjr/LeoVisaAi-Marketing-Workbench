import Link from "next/link";
import { getLibraryTopics, isDemoMode } from "@/lib/topics";
import { STATUS_LABEL } from "@/lib/status";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

export default async function TopicsPage() {
  const [topics, demo] = await Promise.all([getLibraryTopics(), isDemoMode()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">选题库</h1>
        <Link href="/topics/new">
          <Button disabled={demo}>新建选题</Button>
        </Link>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），新建/编辑已禁用。
        </p>
      )}

      {topics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无选题。</p>
      ) : (
        <ul>
          {topics.map((topic) => (
            <li
              key={topic.id}
              className="border-b border-[var(--border)] py-3 last:border-b-0"
            >
              <Link href={`/topics/${topic.id}`} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted)]">{topic.code}</p>
                  <p className="truncate font-medium">{topic.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <StatusBadge status={topic.status} />
                    <span className="text-xs text-[var(--muted)]">
                      {STATUS_LABEL[topic.status]} · 优先级 {topic.priority}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold">{topic.topic_score}</p>
                  <p className="text-xs text-[var(--muted)]">评分</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
