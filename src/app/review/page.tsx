import Link from "next/link";
import { getAllContentAssets, getAllTopics, getLatestResearchPack, isDemoMode } from "@/lib/topics";
import { groupContentAssetsByTopicId } from "@/lib/content-versions";
import { buildLeoReviewQueue } from "@/lib/employee-tasks";
import { getEmployeeNames } from "@/lib/employee-names";
import { Button } from "@/components/ui/button";
import type { ResearchConfidence } from "@/lib/types";

export default async function ReviewQueuePage() {
  const [allTopics, allContentAssets, demo, employeeNames] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
    getEmployeeNames(),
  ]);

  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);

  const researchReadyTopics = allTopics.filter((t) => t.status === "RESEARCH_READY");
  const confidenceEntries = await Promise.all(
    researchReadyTopics.map(async (topic) => {
      const pack = await getLatestResearchPack(topic.id);
      return [topic.id, pack?.confidence] as const;
    }),
  );
  const confidenceByTopicId = new Map(
    confidenceEntries.filter((e): e is [string, ResearchConfidence] => Boolean(e[1])),
  );

  const queue = buildLeoReviewQueue(allTopics, assetsByTopicId, confidenceByTopicId, employeeNames);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Leo 待处理</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          数字员工已经先做完了力所能及的工作，这里是需要你亲自决定的事项。
        </p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      {queue.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">太好了，暂时没有需要你处理的事项。</p>
      ) : (
        <ul>
          {queue.map((item) => (
            <li
              key={`${item.employeeId}-${item.topicId}`}
              className="flex flex-col gap-2 border-b border-[var(--border)] py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-xs text-[var(--muted)]">{item.employeeName}提交</p>
                <p className="font-medium">{item.topicTitle}</p>
                <p className="text-sm text-[var(--muted)]">{item.description}</p>
                {item.warning && (
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{item.warning}</p>
                )}
              </div>
              <Link href={item.href} className="shrink-0">
                <Button variant="secondary">
                  {item.employeeId === "researcher" ? "审核研究" : "查看内容"}
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
