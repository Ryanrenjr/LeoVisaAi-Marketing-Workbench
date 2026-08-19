import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { groupContentAssetsByLineage, groupContentAssetsByTopicId } from "@/lib/content-versions";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee } from "@/lib/boss-language";
import type { ContentAsset, Topic } from "@/lib/types";

function platformStatus(assets: ContentAsset[] | undefined): string {
  if (!assets || assets.length === 0) return "待生成";
  const latest = [...assets].sort((a, b) => b.version - a.version)[0];
  return `草稿已完成（v${latest.version}）`;
}

function TopicContentRow({ topic, assets }: { topic: Topic; assets: ContentAsset[] }) {
  const lineages = groupContentAssetsByLineage(assets);
  const video = lineages.find((l) => l.platform === "VIDEO_CHANNEL" && l.contentType === "video_script");
  const xhs = lineages.find((l) => l.platform === "XIAOHONGSHU" && l.contentType === "xiaohongshu_post");
  const wechatOutline = lineages.find(
    (l) => l.platform === "WECHAT_OFFICIAL_ACCOUNT" && l.contentType === "wechat_outline",
  );
  const wechatFull = lineages.find(
    (l) => l.platform === "WECHAT_OFFICIAL_ACCOUNT" && l.contentType === "wechat_full_article",
  );
  const wechatStatus = wechatFull
    ? `完整文章已完成（v${wechatFull.latest.version}）`
    : wechatOutline
      ? `结构已完成（v${wechatOutline.latest.version}）`
      : "待生成";

  return (
    <li className="border-b border-[var(--border)] py-3 last:border-b-0">
      <Link href={`/topics/${topic.id}?tab=video`} className="font-medium hover:underline">
        {topic.title}
      </Link>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>研究：已确认</span>
        <span>视频号：{video ? platformStatus(video.history) : "待生成"}</span>
        <span>小红书：{xhs ? platformStatus(xhs.history) : "待生成"}</span>
        <span>公众号：{wechatStatus}</span>
      </div>
    </li>
  );
}

export default async function EditorPage() {
  const employee = getEmployee("editor");
  const [allTopics, allContentAssets, demo] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
  ]);

  const eligibleTopics = filterContentEligibleTopics(allTopics).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
            {employee.letter}
          </span>
          <h1 className="text-lg font-semibold">{employee.name}</h1>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">哪些内容已经写好了？</p>
      </div>

      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。
        </p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已确认研究、可以生成内容的选题。</p>
      ) : (
        <ul>
          {eligibleTopics.map((topic) => (
            <TopicContentRow key={topic.id} topic={topic} assets={assetsByTopicId.get(topic.id) ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}
