import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { getContentImagesForTopic } from "@/lib/content-images";
import { getLeoPortraits } from "@/lib/leo-portraits";
import { canManageContentAssets } from "@/lib/permissions";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { GenerateAction } from "@/components/ai/generate-action";
import { CoverWithPortraitAction } from "@/components/ai/cover-with-portrait-action";
import { ContentImageGrid } from "@/components/content/content-image-grid";
import { LeoPortraitGrid } from "@/components/leo-portrait-grid";
import { UploadLeoPortraitForm } from "@/components/upload-leo-portrait-form";
import { generateWechatCover, generateXiaohongshuCarousel } from "./actions";
import type { ContentAsset, Topic } from "@/lib/types";

/**
 * Always show all three buttons — a button that silently disappears when
 * its prerequisite text isn't ready yet reads as "the button is gone" /
 * "this is broken" (live user report: "没看到按钮啊"). Disabled + a plain
 * reason is more honest than making the option vanish.
 */
function DisabledActionRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--muted)] opacity-60">
      <span>{label}</span>
      <span className="text-xs">{reason}</span>
    </div>
  );
}

async function TopicRow({
  topic,
  assets,
  modelOptions,
  hasPortraits,
}: {
  topic: Topic;
  assets: ContentAsset[];
  modelOptions: Awaited<ReturnType<typeof getTaskModelOptions>> | null;
  hasPortraits: boolean;
}) {
  const allImages = await getContentImagesForTopic(topic.id);
  const covers = allImages.filter((img) => img.image_kind === "cover");
  const carousel = allImages
    .filter((img) => img.image_kind === "carousel")
    .sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));

  const xhsPost = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  const xhsPagesPlan = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_pages");
  const videoScript = getLatestForLineage(assets, "VIDEO_CHANNEL", "video_script");
  const wechatArticle = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_article");
  const wechatOutline = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline");
  const wechatFull = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_full_article");

  const canCover = Boolean(xhsPost || videoScript);
  const canWechatCover = Boolean(wechatArticle || wechatOutline || wechatFull);
  const canCarousel = Boolean(xhsPagesPlan);

  return (
    <li className="card flex flex-col gap-4 px-5 py-4">
      <p className="font-medium">{topic.title}</p>

      {covers.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-[var(--muted)]">封面</p>
          <ContentImageGrid images={covers} />
        </div>
      )}
      {carousel.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-[var(--muted)]">小红书图文</p>
          <ContentImageGrid images={carousel} />
        </div>
      )}

      {modelOptions && (
        <div className="flex flex-col gap-3">
          {canCover ? (
            <CoverWithPortraitAction
              topicId={topic.id}
              hasPortraits={hasPortraits}
              models={modelOptions.models}
              defaultModel={modelOptions.defaultModel}
              resolutionError={modelOptions.resolutionError}
            />
          ) : (
            <DisabledActionRow label="生成小红书/视频封面" reason="先生成小红书文案或视频口播稿" />
          )}
          {canWechatCover ? (
            <GenerateAction
              action={async (override) => {
                "use server";
                return generateWechatCover(topic.id, override);
              }}
              label="生成公众号封面"
              variant="secondary"
              taskType="IMAGE_GENERATION"
              models={modelOptions.models}
              defaultModel={modelOptions.defaultModel}
              resolutionError={modelOptions.resolutionError}
            />
          ) : (
            <DisabledActionRow label="生成公众号封面" reason="先生成公众号文章" />
          )}
          {canCarousel ? (
            <GenerateAction
              action={async (override) => {
                "use server";
                return generateXiaohongshuCarousel(topic.id, override);
              }}
              label={carousel.length > 0 ? "重新生成小红书图文" : "生成小红书图文"}
              variant="secondary"
              taskType="IMAGE_GENERATION"
              models={modelOptions.models}
              defaultModel={modelOptions.defaultModel}
              resolutionError={modelOptions.resolutionError}
            />
          ) : (
            <DisabledActionRow label="生成小红书图文" reason="先请小红书图文规划员生成图文规划" />
          )}
        </div>
      )}
    </li>
  );
}

export default async function ImageDesignerPage() {
  const employee = getEmployee("image-designer");
  const [allTopics, allContentAssets, demo, employeeNames, user, portraits] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
    getEmployeeNames(),
    getCurrentUser(),
    getLeoPortraits(),
  ]);
  const employeeName = resolveEmployeeDisplayName("image-designer", employeeNames);

  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  // Every content-eligible topic — even ones with no text draft yet at
  // all — so the three buttons (and their disabled-state reasons) are
  // always visible and honest about what's still needed, rather than the
  // whole row disappearing.
  const eligibleTopics = filterContentEligibleTopics(allTopics).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  const canRun = !demo && user && canManageContentAssets(user.role);
  const modelOptions = canRun ? await getTaskModelOptions("IMAGE_GENERATION") : null;
  const hasPortraits = portraits.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="image-designer"
        letter={employee.letter}
        name={employeeName}
        subtitle="小红书/视频封面、公众号封面、小红书图文（P1-P6）——根据已经写好的文字或小红书图文规划员的规划生成配图。"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），配图生成已禁用。
        </p>
      )}

      {canRun && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">李尔王特写照片</h2>
            <p className="text-xs text-[var(--muted)]">
              真实照片，不是 AI 生成——生成小红书/视频封面时勾选&ldquo;带李尔王特写&rdquo;，会自动用最新上传的这张照片合成到封面上。
            </p>
          </div>
          <LeoPortraitGrid portraits={portraits} canManage={Boolean(canRun)} />
          <UploadLeoPortraitForm />
        </section>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已写好文字、可以生成配图的选题。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eligibleTopics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              assets={assetsByTopicId.get(topic.id) ?? []}
              modelOptions={modelOptions}
              hasPortraits={hasPortraits}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
