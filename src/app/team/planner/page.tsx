import Link from "next/link";
import { getLibraryTopics, isDemoMode } from "@/lib/topics";
import { getEmployee, BOSS_STATUS_LABEL } from "@/lib/boss-language";
import { Button } from "@/components/ui/button";
import type { Topic } from "@/lib/types";

function TopicRow({ topic }: { topic: Topic }) {
  return (
    <li className="border-b border-[var(--border)] py-2 last:border-b-0">
      <Link href={`/topics/${topic.id}`} className="flex items-center justify-between gap-4 hover:underline">
        <span className="truncate">{topic.title}</span>
        <span className="shrink-0 text-xs text-[var(--muted)]">{BOSS_STATUS_LABEL[topic.status]}</span>
      </Link>
    </li>
  );
}

function TopicList({ topics, empty }: { topics: Topic[]; empty: string }) {
  if (topics.length === 0) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <ul>
      {topics.map((t) => (
        <TopicRow key={t.id} topic={t} />
      ))}
    </ul>
  );
}

export default async function PlannerPage() {
  const employee = getEmployee("planner");
  const [libraryTopics, demo] = await Promise.all([getLibraryTopics(), isDemoMode()]);

  const highPriority = libraryTopics.filter((t) => t.priority === "HIGH");
  const notStarted = libraryTopics.filter((t) => t.status === "IDEA");
  const recentlyCreated = [...libraryTopics]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
            {employee.letter}
          </span>
          <h1 className="text-lg font-semibold">{employee.name}</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">今天值得做什么？</p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/topics">
          <Button>查看选题</Button>
        </Link>
        <Link href="/topics/new">
          <Button variant="secondary">新建想法</Button>
        </Link>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">高优先级选题</h2>
        <TopicList topics={highPriority} empty="暂无高优先级选题。" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">待开始选题</h2>
        <TopicList topics={notStarted} empty="暂无待开始的选题。" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">最近新建选题</h2>
        <TopicList topics={recentlyCreated} empty="暂无选题。" />
      </section>
    </div>
  );
}
