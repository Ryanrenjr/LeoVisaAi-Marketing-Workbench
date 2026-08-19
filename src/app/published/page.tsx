import { getPublishedThisWeek, isDemoMode } from "@/lib/topics";
import { TopicCard } from "@/components/topic-card";

export default async function PublishedPage() {
  const [topics, demo] = await Promise.all([getPublishedThisWeek(), isDemoMode()]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">本周已发布</h1>
      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}
      {topics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">本周暂无已发布内容。</p>
      ) : (
        <ul>
          {topics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </ul>
      )}
    </div>
  );
}
