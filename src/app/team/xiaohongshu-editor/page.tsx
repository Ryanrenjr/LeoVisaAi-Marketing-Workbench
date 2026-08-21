import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getAllContentImages } from "@/lib/content-images";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { platformStatusLabel } from "@/lib/content-editor-status";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import type { ContentAsset, ContentImageRow, Topic } from "@/lib/types";

function TopicRow({
  topic,
  assets,
  imagesByAssetId,
}: {
  topic: Topic;
  assets: ContentAsset[];
  imagesByAssetId: Map<string, ContentImageRow[]>;
}) {
  const post = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  const hasImages = post ? (imagesByAssetId.get(post.id)?.length ?? 0) > 0 : false;
  return (
    <li className="border-b border-[var(--border)] py-3 last:border-b-0">
      <Link href={`/topics/${topic.id}?tab=xiaohongshu`} className="font-medium hover:underline">
        {topic.title}
      </Link>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>研究：已确认</span>
        <span>{platformStatusLabel(assets, "XIAOHONGSHU")}</span>
        <span>图片：{hasImages ? "已配图" : "待配图"}</span>
      </div>
    </li>
  );
}

export default async function XiaohongshuEditorPage() {
  const employee = getEmployee("xiaohongshu-editor");
  const [allTopics, allContentAssets, allContentImages, demo, employeeNames] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    getAllContentImages(),
    isDemoMode(),
    getEmployeeNames(),
  ]);
  const employeeName = resolveEmployeeDisplayName("xiaohongshu-editor", employeeNames);

  const eligibleTopics = filterContentEligibleTopics(allTopics).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  const imagesByAssetId = new Map<string, ContentImageRow[]>();
  for (const image of allContentImages) {
    if (!image.content_asset_id) continue;
    const list = imagesByAssetId.get(image.content_asset_id);
    if (list) list.push(image);
    else imagesByAssetId.set(image.content_asset_id, [image]);
  }

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="xiaohongshu-editor"
        letter={employee.letter}
        name={employeeName}
        subtitle="哪些小红书攻略文字已经写好了？"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">当前为演示数据（未连接 Supabase）。</p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已确认研究、可以生成内容的选题。</p>
      ) : (
        <ul>
          {eligibleTopics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              assets={assetsByTopicId.get(topic.id) ?? []}
              imagesByAssetId={imagesByAssetId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
