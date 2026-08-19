import { getTopicsByStatus, isDemoMode } from "@/lib/topics";
import { TopicCard } from "@/components/topic-card";

export default async function ResearchCompletedPage() {
  const [topics, demo] = await Promise.all([
    getTopicsByStatus("RESEARCH_APPROVED"),
    isDemoMode(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">研究已完成</h1>
      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}
      <p className="text-sm text-[var(--muted)]">
        以下选题的研究已获批准，等待内容生成（Content AI 尚未上线，暂无法在此手动推进）。
      </p>
      {topics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无选题。</p>
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
