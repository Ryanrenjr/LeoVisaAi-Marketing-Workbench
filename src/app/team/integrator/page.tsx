import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getAllContentImages } from "@/lib/content-images";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import { ContentImageGrid } from "@/components/content/content-image-grid";
import { MarkdownText } from "@/components/content/markdown-text";
import { Button } from "@/components/ui/button";
import { discardTopic } from "@/app/topics/actions";
import type { VideoChannelContent, WechatArticle, XiaohongshuContent } from "@/lib/ai/content-schemas";
import type { ContentAsset, ContentImageRow, ContentPlatform, Topic } from "@/lib/types";

/**
 * Employee I（内容整合员）— pure read-only assembly, no generation, no
 * mutation. Text (C/D/F, revised by H if compliance flagged something)
 * and cover/carousel images (E) are produced by different employees on
 * different pages; this is the one place that shows, per platform, the
 * latest text + its images together — so Leo's final look (the human
 * gate right after this step) is at the assembled package, not scattered
 * pieces. See docs/digital-employee-skills.md "I｜内容整合员". Live user
 * instruction: 小红书标题文案（D）和图文规划（K）曾经是两个独立的卡片，合并成
 * 一个"小红书"卡片里的两个小节（标题文案 / 图文规划），因为都是同一个平台
 * 的内容 — see XiaohongshuBlock below.
 */

function PlatformBlock({
  label,
  topicId,
  platform,
  title,
  body,
  textHref,
  covers,
  imageHref,
}: {
  label: string;
  topicId: string;
  platform: ContentPlatform;
  title: string | null;
  body: string | null;
  textHref: string;
  covers: ContentImageRow[];
  imageHref: string;
}) {
  const hasPackage = title !== null && body !== null;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--border)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {hasPackage && (
          <a
            href={`/api/integrator/download?topicId=${topicId}&platform=${platform}`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            下载 →
          </a>
        )}
      </div>

      {title !== null && body !== null ? (
        <div className="mt-2">
          <p className="text-sm font-medium">{title}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-[var(--muted)]">展开全文</summary>
            <div className="mt-2 text-sm">
              <MarkdownText text={body} />
            </div>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">
          文字：待生成 ·{" "}
          <Link href={textHref} className="text-[var(--accent)] hover:underline">
            去生成 →
          </Link>
        </p>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs text-[var(--muted)]">封面{covers.length === 0 ? "：待生成" : ""}</p>
        {covers.length > 0 ? (
          <ContentImageGrid images={covers} />
        ) : (
          <Link href={imageHref} className="text-xs text-[var(--accent)] hover:underline">
            去配图 →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * 视频号's final product — 发布标题/发布内容/口播稿 + 独立视频封面. Round 9
 * P0 fix: this used to display the internal production `title`/
 * `full_script` fields (and shared a cover with 小红书); the real final
 * deliverable is 发布标题/发布内容/口播稿 (see docs — "视频号最终交付包"),
 * with its own independent cover.
 */
function VideoBlock({
  topicId,
  publishTitle,
  publishCaption,
  fullScript,
  textHref,
  covers,
  imageHref,
}: {
  topicId: string;
  publishTitle: string | null;
  publishCaption: string | null;
  fullScript: string | null;
  textHref: string;
  covers: ContentImageRow[];
  imageHref: string;
}) {
  const hasPackage = publishTitle !== null && publishCaption !== null && fullScript !== null;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--border)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">视频号</p>
        {hasPackage && (
          <a
            href={`/api/integrator/download?topicId=${topicId}&platform=VIDEO_CHANNEL`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            下载 →
          </a>
        )}
      </div>

      {hasPackage ? (
        <div className="mt-2">
          <p className="text-sm font-medium">{publishTitle}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-[var(--muted)]">展开发布内容 + 口播稿</summary>
            <div className="mt-2 flex flex-col gap-3 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">发布内容</p>
                <MarkdownText text={publishCaption ?? ""} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">口播稿</p>
                <MarkdownText text={fullScript ?? ""} />
              </div>
            </div>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">
          文字：待生成 ·{" "}
          <Link href={textHref} className="text-[var(--accent)] hover:underline">
            去生成 →
          </Link>
        </p>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs text-[var(--muted)]">封面{covers.length === 0 ? "：待生成" : ""}</p>
        {covers.length > 0 ? (
          <ContentImageGrid images={covers} />
        ) : (
          <Link href={imageHref} className="text-xs text-[var(--accent)] hover:underline">
            去配图 →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * 小红书's final product — one card, no internal production breakdown.
 * Round 9 P0 fix: this used to show 标题文案（D）and 图文规划（K）as two
 * separately-labeled sections (each with its own "展开全文"), which is
 * exactly the "internal production structure" the final product view must
 * not expose. Now shows only 发布标题 + 发布内容 (from D's draft) and the
 * P1–Pn carousel (from K's plan, illustrated by E) — P1 IS the 首图, no
 * separate cover exists any more.
 */
function XiaohongshuBlock({
  topicId,
  postTitle,
  postBody,
  postTextHref,
  pagesTextHref,
  pagesImages,
}: {
  topicId: string;
  postTitle: string | null;
  postBody: string | null;
  postTextHref: string;
  pagesTextHref: string;
  pagesImages: ContentImageRow[];
}) {
  const hasAnyPackage = postTitle !== null || pagesImages.length > 0;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--border)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">小红书</p>
        {hasAnyPackage && (
          <a
            href={`/api/integrator/download?topicId=${topicId}&platform=XIAOHONGSHU`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            下载 →
          </a>
        )}
      </div>

      {postTitle !== null && postBody !== null ? (
        <div className="mt-2">
          <p className="text-sm font-medium">{postTitle}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-[var(--muted)]">展开发布内容</summary>
            <div className="mt-2 text-sm">
              <MarkdownText text={postBody} />
            </div>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">
          文字：待生成 ·{" "}
          <Link href={postTextHref} className="text-[var(--accent)] hover:underline">
            去生成 →
          </Link>
        </p>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs text-[var(--muted)]">图文{pagesImages.length === 0 ? "：待生成" : ""}</p>
        {pagesImages.length > 0 ? (
          <ContentImageGrid images={pagesImages} />
        ) : (
          <Link href={pagesTextHref} className="text-xs text-[var(--accent)] hover:underline">
            去配图 →
          </Link>
        )}
      </div>
    </div>
  );
}

function TopicCard({
  topic,
  assets,
  imagesByAssetId,
  demo,
}: {
  topic: Topic;
  assets: ContentAsset[];
  imagesByAssetId: Map<string, ContentImageRow[]>;
  demo: boolean;
}) {
  const videoScript = getLatestForLineage(assets, "VIDEO_CHANNEL", "video_script");
  const xhsPost = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  const xhsPages = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_pages");
  const wechatArticle = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_article");

  const videoContent = videoScript?.structured_content as unknown as VideoChannelContent | undefined;
  const xhsContent = xhsPost?.structured_content as unknown as XiaohongshuContent | undefined;
  const wechatContent = wechatArticle?.structured_content as unknown as WechatArticle | undefined;

  const xhsPagesImages = xhsPages ? (imagesByAssetId.get(xhsPages.id) ?? []) : [];

  return (
    <li className="card flex flex-col gap-4 px-5 py-4">
      <Link href={`/topics/${topic.id}`} className="font-medium hover:underline">
        {topic.title}
      </Link>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <VideoBlock
          topicId={topic.id}
          publishTitle={videoContent?.publish_title ?? null}
          publishCaption={videoContent?.publish_caption ?? null}
          fullScript={videoContent?.full_script ?? null}
          textHref={`/topics/${topic.id}?tab=video`}
          covers={videoScript ? (imagesByAssetId.get(videoScript.id) ?? []) : []}
          imageHref="/team/image-designer"
        />
        <XiaohongshuBlock
          topicId={topic.id}
          postTitle={xhsContent ? (xhsContent.title_options[0] ?? xhsContent.cover_title) : null}
          postBody={xhsContent?.caption ?? null}
          postTextHref={`/topics/${topic.id}?tab=xiaohongshu`}
          pagesTextHref="/team/xiaohongshu-image-planner"
          pagesImages={xhsPagesImages
            .filter((img) => img.image_kind === "carousel")
            .sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0))}
        />
        <PlatformBlock
          label="公众号"
          topicId={topic.id}
          platform="WECHAT_OFFICIAL_ACCOUNT"
          title={wechatContent?.title ?? null}
          body={wechatContent?.full_article ?? null}
          textHref={`/topics/${topic.id}?tab=wechat`}
          covers={wechatArticle ? (imagesByAssetId.get(wechatArticle.id) ?? []) : []}
          imageHref="/team/image-designer"
        />
      </div>
      {!demo && (
        <div className="flex flex-col items-end gap-2 self-end">
          <a
            href={`/api/integrator/download?topicId=${topic.id}&platform=all`}
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            打包下载全部平台 →
          </a>
          <form action={discardTopic.bind(null, topic.id)}>
            <p className="mb-2 text-xs text-[var(--muted)]">打包下载好了再点——点了这条选题就没了。</p>
            <Button type="submit" variant="secondary">
              完成，清空这条选题
            </Button>
          </form>
        </div>
      )}
    </li>
  );
}

export default async function IntegratorPage() {
  const employee = getEmployee("integrator");
  const [allTopics, allContentAssets, allContentImages, demo, employeeNames] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    getAllContentImages(),
    isDemoMode(),
    getEmployeeNames(),
  ]);
  const employeeName = resolveEmployeeDisplayName("integrator", employeeNames);

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
        avatarId="integrator"
        letter={employee.letter}
        name={employeeName}
        subtitle="每个平台改好的文字和配图放在一起，方便你一次看完最终成品，再决定要不要进入拍摄。不生成、不修改任何内容。"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">当前为演示数据（未连接 Supabase）。</p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已确认研究、可以生成内容的选题。</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {eligibleTopics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              assets={assetsByTopicId.get(topic.id) ?? []}
              imagesByAssetId={imagesByAssetId}
              demo={demo}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
