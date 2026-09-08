import "server-only";
import JSZip from "jszip";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { renderContentAsHtml } from "@/lib/content-html-export";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import type { ContentAsset, ContentPlatform, ContentType } from "@/lib/types";

/**
 * Employee I（内容整合员）"下载这个包" — zips one platform's latest text
 * draft(s) together with its images (cover, plus carousel pages for
 * Xiaohongshu's image-text plan) into a single file, since a browser
 * can't hand back an actual folder. Read-only: reuses exactly the same
 * data the integrator page already displays, no new generation, no
 * mutation. XIAOHONGSHU has two independent lineages (title/caption +
 * image-text plan, written by two different employees — live user
 * instruction) so both get included when present.
 *
 * `platform=all` (or omitted) zips all three platforms together, each in
 * its own top-level folder — the literal "打包" Leo asked for, so
 * "生成 → 审核 → 校对 → 打包" is one download instead of three.
 */
const PLATFORM_CONTENT_TYPES: Record<ContentPlatform, { contentType: ContentType; label: string }[]> = {
  VIDEO_CHANNEL: [{ contentType: "video_script", label: "标题与正文" }],
  XIAOHONGSHU: [
    { contentType: "xiaohongshu_post", label: "标题与文案" },
    { contentType: "xiaohongshu_pages", label: "图文规划" },
  ],
  WECHAT_OFFICIAL_ACCOUNT: [{ contentType: "wechat_article", label: "标题与正文" }],
};

const ALL_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

interface PlatformZipResult {
  foundAny: boolean;
  /** Non-empty means this platform's package is incomplete — the whole request must fail closed instead of shipping a partial zip (see GET's final check). */
  problems: string[];
}

async function addPlatformToZip(
  zip: JSZip,
  supabase: Awaited<ReturnType<typeof createClient>>,
  assets: ContentAsset[],
  platform: ContentPlatform,
  folderPrefix: string,
): Promise<PlatformZipResult> {
  const contentTypes = PLATFORM_CONTENT_TYPES[platform];
  let foundAny = false;
  const problems: string[] = [];

  for (const { contentType, label } of contentTypes) {
    const asset = getLatestForLineage(assets, platform, contentType);
    if (!asset) {
      // Live audit finding (round 7): a whole missing asset used to be a
      // silent `continue` — an expected content type this platform is
      // supposed to have (e.g. XIAOHONGSHU's xiaohongshu_pages plan) that
      // simply never got generated produced a "successful" zip missing an
      // entire piece, instead of failing closed like a missing image does.
      problems.push(`${folderPrefix}${label}：内容不存在`);
      continue;
    }
    foundAny = true;

    const { data: images, error: imagesError } = await supabase
      .from("content_images")
      .select("image_path, image_kind, page_index")
      .eq("content_asset_id", asset.id)
      .order("page_index", { ascending: true, nullsFirst: true });
    if (imagesError) {
      problems.push(`${folderPrefix}${label}：读取图片记录失败（${imagesError.message}）`);
      continue;
    }

    // Use the already-stored title/content columns rather than
    // recomputing from structured_content — they were derived once, at
    // save time, by the same generation/revision code path that also
    // deterministically appends the WeChat brand footer (see
    // content-mapping.ts's deriveTitleAndContent + buildWechatBrandFooter).
    // Recomputing here would silently drop that footer, since it has no
    // access to brand_config at download time.
    const subfolder = contentTypes.length > 1 ? `${label}/` : "";
    zip.file(`${folderPrefix}${subfolder}${label}.html`, renderContentAsHtml(asset.title, asset.content));

    let carouselDownloaded = 0;
    let hasCover = false;
    for (const image of images ?? []) {
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from("content-images")
        .download(image.image_path);
      if (!downloaded || downloadError) {
        const what = image.image_kind === "carousel" ? `第${image.page_index ?? "?"}页图片` : "封面图片";
        problems.push(`${folderPrefix}${label}：${what}下载失败（${downloadError?.message ?? "未知错误"}）`);
        continue;
      }
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      const ext = image.image_path.split(".").pop() ?? "png";
      const filename =
        image.image_kind === "carousel"
          ? `${folderPrefix}${subfolder}图文/第${image.page_index ?? "?"}页.${ext}`
          : `${folderPrefix}${subfolder}封面.${ext}`;
      zip.file(filename, bytes);
      if (image.image_kind === "carousel") carouselDownloaded++;
      if (image.image_kind === "cover") hasCover = true;
    }

    if (contentType === "xiaohongshu_pages") {
      // xiaohongshu_pages declares how many pages the plan has; cross-check
      // against how many carousel images actually made it into the zip —
      // catches "plan says 6 pages, only 4 got generated/downloaded" instead
      // of shipping a silently-incomplete carousel.
      const declaredPages = (asset.structured_content as { pages?: unknown[] } | null)?.pages?.length ?? 0;
      if (declaredPages > 0 && carouselDownloaded !== declaredPages) {
        problems.push(`${folderPrefix}${label}：规划共 ${declaredPages} 页，实际打包 ${carouselDownloaded} 页`);
      }
    } else if (!hasCover) {
      // Every other content type (video_script / xiaohongshu_post /
      // wechat_article) is the lineage the shared/WeChat cover gets saved
      // against (see generateCrossPlatformCover/generateWechatCover) — a
      // package for this platform is incomplete without one.
      problems.push(`${folderPrefix}${label}：封面缺失`);
    }
  }

  return { foundAny, problems };
}

export async function GET(request: Request) {
  await requireUser();

  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get("topicId");
  const platformParam = searchParams.get("platform");
  if (!topicId) return new Response("Missing topicId.", { status: 400 });

  const topic = await getTopicById(topicId);
  if (!topic) return new Response("Topic not found.", { status: 404 });

  const assets = await getContentAssets(topicId);
  const supabase = await createClient();
  const zip = new JSZip();

  let foundAny = false;
  let filenameSuffix: string;
  const problems: string[] = [];

  if (!platformParam || platformParam === "all") {
    // Scoped to what this generation run actually selected (live audit
    // finding, round 7) — not "whatever happens to exist in
    // content_assets". A topic generated with only VIDEO_CHANNEL selected
    // must never have "打包下载全部平台" silently sweep in older/manually-
    // generated XIAOHONGSHU or WECHAT content that was never part of this
    // run's scope. Falls back to every platform when no run exists at all
    // (e.g. content was produced entirely by hand from each employee's own
    // page, never through "一键生成") — same "有什么打什么" behavior as
    // before for that path.
    const { data: run, error: runError } = await supabase
      .from("generation_runs")
      .select("platforms")
      .eq("topic_id", topicId)
      .maybeSingle();
    if (runError) return new Response(`读取生成范围失败，请重试：${runError.message}`, { status: 500 });
    const expectedPlatforms = (run?.platforms as ContentPlatform[] | undefined) ?? ALL_PLATFORMS;

    for (const platform of expectedPlatforms) {
      const result = await addPlatformToZip(zip, supabase, assets, platform, `${CONTENT_PLATFORM_LABEL[platform]}/`);
      foundAny = foundAny || result.foundAny;
      problems.push(...result.problems);
    }
    filenameSuffix = "全部平台";
  } else {
    const platform = platformParam as ContentPlatform;
    if (!(platform in PLATFORM_CONTENT_TYPES)) {
      return new Response("Invalid platform.", { status: 400 });
    }
    const result = await addPlatformToZip(zip, supabase, assets, platform, "");
    foundAny = result.foundAny;
    problems.push(...result.problems);
    filenameSuffix = CONTENT_PLATFORM_LABEL[platform];
  }

  // Fail closed: a partial zip (missing image, unreadable record, page
  // count mismatch, or now a whole missing asset) is worse than no zip —
  // the operator could otherwise download an incomplete package and then
  // hit "完成，清空这条选题", permanently losing the only copy of what
  // didn't make it in. Checked before the generic "nothing found" 404 so a
  // concrete reason always wins over a vague one.
  if (problems.length > 0) {
    return new Response(`打包未完成，以下内容缺失：\n${problems.join("\n")}`, { status: 500 });
  }
  if (!foundAny) return new Response("No content for this topic yet.", { status: 404 });

  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const filename = `${topic.title}-${filenameSuffix}`.replace(/[\\/:*?"<>|]/g, "_");

  return new Response(new Uint8Array(zipBytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(filename)}.zip`,
    },
  });
}
