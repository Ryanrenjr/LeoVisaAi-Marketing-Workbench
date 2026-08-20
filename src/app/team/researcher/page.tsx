import Link from "next/link";
import { getAllTopics, getLatestResearchPack, getResearchSources, isDemoMode } from "@/lib/topics";
import { getEmployee, resolveEmployeeDisplayName, BOSS_CONFIDENCE_LABEL, BOSS_STATUS_LABEL } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import type { ResearchConfidence, Topic } from "@/lib/types";

interface PackInfo {
  confidence: ResearchConfidence;
  sourceCount: number;
}

function ResearchRow({ topic, info }: { topic: Topic; info?: PackInfo }) {
  // Awaiting-review items go to the dedicated, single-purpose approval
  // screen — everything else still goes to the full Topic Detail page.
  const href =
    topic.status === "RESEARCH_READY" ? `/topics/${topic.id}/research/review` : `/topics/${topic.id}?tab=research`;
  return (
    <li className="border-b border-[var(--border)] py-3 last:border-b-0">
      <Link href={href} className="flex flex-col gap-1 hover:underline">
        <span className="font-medium">{topic.title}</span>
      </Link>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>状态：{BOSS_STATUS_LABEL[topic.status]}</span>
        {info && (
          <>
            <span>官方来源：{info.sourceCount}</span>
            <span>{BOSS_CONFIDENCE_LABEL[info.confidence]}</span>
          </>
        )}
      </div>
    </li>
  );
}

function TopicList({
  topics,
  infoByTopicId,
  empty,
}: {
  topics: Topic[];
  infoByTopicId?: Map<string, PackInfo>;
  empty: string;
}) {
  if (topics.length === 0) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <ul>
      {topics.map((t) => (
        <ResearchRow key={t.id} topic={t} info={infoByTopicId?.get(t.id)} />
      ))}
    </ul>
  );
}

export default async function ResearcherPage() {
  const employee = getEmployee("researcher");
  const [allTopics, demo, employeeNames] = await Promise.all([
    getAllTopics(),
    isDemoMode(),
    getEmployeeNames(),
  ]);
  const employeeName = resolveEmployeeDisplayName("researcher", employeeNames);

  const inProgress = allTopics.filter((t) => t.status === "RESEARCHING");
  const awaitingReview = allTopics.filter((t) => t.status === "RESEARCH_READY");
  const approved = allTopics
    .filter((t) => t.status === "RESEARCH_APPROVED")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10);

  const needsPackInfo = [...awaitingReview, ...approved];
  const infoEntries = await Promise.all(
    needsPackInfo.map(async (topic) => {
      const pack = await getLatestResearchPack(topic.id);
      if (!pack) return null;
      const sources = await getResearchSources(pack.id);
      return [topic.id, { confidence: pack.confidence, sourceCount: sources.length }] as const;
    }),
  );
  const infoByTopicId = new Map(
    infoEntries.filter((e): e is [string, PackInfo] => e !== null),
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
            {employee.letter}
          </span>
          <h1 className="text-lg font-semibold">{employeeName}</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">哪些事情已经查清楚了？</p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">研究中</h2>
        <TopicList topics={inProgress} empty="暂无正在进行的研究。" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">研究完成，等Leo确认</h2>
        <TopicList topics={awaitingReview} infoByTopicId={infoByTopicId} empty="暂无待确认的研究。" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">已批准研究</h2>
        <TopicList topics={approved} infoByTopicId={infoByTopicId} empty="暂无已批准的研究。" />
      </section>
    </div>
  );
}
