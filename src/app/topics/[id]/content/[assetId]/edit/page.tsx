import { notFound } from "next/navigation";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { ContentEditForm } from "@/components/content-edit-form";

export default async function EditContentAssetPage({
  params,
}: {
  params: Promise<{ id: string; assetId: string }>;
}) {
  const { id, assetId } = await params;
  const [topic, assets] = await Promise.all([getTopicById(id), getContentAssets(id)]);
  const asset = assets.find((a) => a.id === assetId);
  if (!topic || !asset) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold">
        编辑{CONTENT_PLATFORM_LABEL[asset.platform]}草稿 · {topic.code}
      </h1>
      <p className="text-sm text-[var(--muted)]">
        仅可编辑标题与正文 — 保存后会创建新版本（v{asset.version + 1}），不会覆盖当前版本。
      </p>
      <ContentEditForm
        topicId={topic.id}
        assetId={asset.id}
        initial={{ title: asset.title, content: asset.content }}
      />
    </div>
  );
}
