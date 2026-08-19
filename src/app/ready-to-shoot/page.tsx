import { getTopicsByStatus, isDemoMode } from "@/lib/topics";
import { TopicCard } from "@/components/topic-card";
import { AdvanceButton } from "@/components/advance-button";

export default async function ReadyToShootPage() {
  const [topics, demo] = await Promise.all([
    getTopicsByStatus("READY_TO_SHOOT"),
    isDemoMode(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">可进入拍摄</h1>
      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}
      {topics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无选题。</p>
      ) : (
        <ul>
          {topics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              action={!demo && <AdvanceButton topic={topic} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
