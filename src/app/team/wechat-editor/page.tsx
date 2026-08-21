import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { getAllContentImages } from "@/lib/content-images";
import { canManageContentAssets } from "@/lib/permissions";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { platformStatusLabel } from "@/lib/content-editor-status";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import { ContentImageGrid } from "@/components/content/content-image-grid";
import { SearchImagesButton } from "@/components/ai/search-images-button";
import { searchAndAttachImages } from "./actions";
import type { ContentAsset, ContentImageRow, Topic } from "@/lib/types";

function TopicRow({
  topic,
  assets,
  imagesByAssetId,
  canRun,
  employeeName,
}: {
  topic: Topic;
  assets: ContentAsset[];
  imagesByAssetId: Map<string, ContentImageRow[]>;
  canRun: boolean;
  employeeName: string;
}) {
  const outline = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline");
  const images = outline ? (imagesByAssetId.get(outline.id) ?? []) : [];
  return (
    <li className="card flex flex-col gap-2 px-5 py-4">
      <Link href={`/topics/${topic.id}?tab=wechat`} className="font-medium hover:underline">
        {topic.title}
      </Link>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>研究：已确认</span>
        <span>{platformStatusLabel(assets, "WECHAT_OFFICIAL_ACCOUNT")}</span>
        <span>图片：{images.length > 0 ? "已配图" : "待配图"}</span>
      </div>
      <ContentImageGrid images={images} />
      {canRun && outline && (
        <SearchImagesButton
          action={searchAndAttachImages.bind(null, topic.id)}
          avatarId="wechat-editor"
          employeeName={employeeName}
          label={images.length > 0 ? "再搜一次配图" : "搜索配图"}
        />
      )}
    </li>
  );
}

export default async function WechatEditorPage() {
  const employee = getEmployee("wechat-editor");
  const [allTopics, allContentAssets, allContentImages, demo, employeeNames, user] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    getAllContentImages(),
    isDemoMode(),
    getEmployeeNames(),
    getCurrentUser(),
  ]);
  const employeeName = resolveEmployeeDisplayName("wechat-editor", employeeNames);

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
  const canRun = !demo && user && canManageContentAssets(user.role);

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="wechat-editor"
        letter={employee.letter}
        name={employeeName}
        subtitle="哪些公众号长文已经写好了？"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">当前为演示数据（未连接 Supabase）。</p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已确认研究、可以生成内容的选题。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eligibleTopics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              assets={assetsByTopicId.get(topic.id) ?? []}
              imagesByAssetId={imagesByAssetId}
              canRun={Boolean(canRun)}
              employeeName={employeeName}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
