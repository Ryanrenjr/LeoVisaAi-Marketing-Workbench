import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { groupContentAssetsByLineage, groupContentAssetsByTopicId } from "@/lib/content-versions";
import { CONTENT_PLATFORM_LABEL, CONTENT_TYPE_LABEL } from "@/lib/status";

export default async function ContentAssetsPage() {
  const [allTopics, allContentAssets, demo] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
  ]);

  const topicById = new Map(allTopics.map((t) => [t.id, t]));
  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);

  const rows = Array.from(assetsByTopicId.entries()).flatMap(([topicId, assets]) =>
    groupContentAssetsByLineage(assets).map((lineage) => ({
      topic: topicById.get(topicId),
      lineage,
    })),
  );
  rows.sort((a, b) => new Date(b.lineage.latest.created_at).getTime() - new Date(a.lineage.latest.created_at).getTime());

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">内容资产库</h1>
      <p className="text-sm text-[var(--muted)]">
        跨选题的内容草稿一览，每行是一个平台的最新版本 — 历史版本请在选题详情页查看。
      </p>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无内容资产。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <th className="py-2 pr-4 font-medium">选题</th>
                <th className="py-2 pr-4 font-medium">平台</th>
                <th className="py-2 pr-4 font-medium">类型</th>
                <th className="py-2 pr-4 font-medium">版本</th>
                <th className="py-2 font-medium">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ topic, lineage }) => (
                <tr
                  key={`${lineage.platform}-${lineage.contentType}-${lineage.latest.topic_id}`}
                  className="border-b border-[var(--border)] last:border-b-0"
                >
                  <td className="py-2 pr-4">
                    {topic ? (
                      <Link href={`/topics/${topic.id}`} className="hover:underline">
                        {topic.title}
                      </Link>
                    ) : (
                      lineage.latest.topic_id
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{CONTENT_PLATFORM_LABEL[lineage.platform]}</td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{CONTENT_TYPE_LABEL[lineage.contentType]}</td>
                  <td className="py-2 pr-4 text-[var(--muted)]">v{lineage.latest.version}</td>
                  <td className="py-2 text-[var(--muted)]">
                    {new Date(lineage.latest.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
