import "server-only";
import JSZip from "jszip";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { renderContentAsHtml, renderSectionsAsHtml } from "@/lib/content-html-export";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import type { ContentAsset, ContentPlatform } from "@/lib/types";

/**
 * Employee I（内容整合员）"下载这个包" — zips one platform's final,
 * publish-ready deliverable (text + images) into a single file, since a
 * browser can't hand back an actual folder. Read-only: reuses exactly the
 * same data the integrator page already displays, no new generation, no
 * mutation.
 *
 * Round 9 P0 fix: each platform's package now matches the real final
 * product, not the internal production structure — VIDEO_CHANNEL ships
 * 发布标题/发布内容/口播稿 + an independent 视频封面; XIAOHONGSHU ships
 * 发布标题/发布内容 + the P1–Pn carousel (P1 IS its 首图 — no separate
 * cover is required any more, the previously-shared 视频号/小红书 cover no
 * longer exists); WECHAT_OFFICIAL_ACCOUNT is unchanged (标题 + 完整正文 +
 * an independent 封面).
 *
 * `platform=all` (or omitted) zips all three platforms together, each in
 * its own top-level folder — the literal "打包" Leo asked for, so
 * "生成 → 审核 → 校对 → 打包" is one download instead of three.
 */
const ALL_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

interface PlatformZipResult {
  foundAny: boolean;
  /** Non-empty means this platform's package is incomplete — the whole request must fail closed instead of shipping a partial zip (see GET's final check). */
  problems: string[];
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function downloadCoverInto(
  zip: JSZip,
  supabase: SupabaseServerClient,
  contentAssetId: string,
  filenameBase: string,
  problemLabel: string,
  problems: string[],
): Promise<boolean> {
  const { data: images, error: imagesError } = await supabase
    .from("content_images")
    .select("image_path, image_kind")
    .eq("content_asset_id", contentAssetId)
    .eq("image_kind", "cover")
    .order("created_at", { ascending: false })
    .limit(1);
  if (imagesError) {
    problems.push(`${problemLabel}：读取图片记录失败（${imagesError.message}）`);
    return false;
  }
  const cover = (images ?? [])[0];
  if (!cover) return false;

  const { data: downloaded, error: downloadError } = await supabase.storage.from("content-images").download(cover.image_path);
  if (!downloaded || downloadError) {
    problems.push(`${problemLabel}：封面图片下载失败（${downloadError?.message ?? "未知错误"}）`);
    return false;
  }
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  const ext = cover.image_path.split(".").pop() ?? "png";
  zip.file(`${filenameBase}.${ext}`, bytes);
  return true;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** VIDEO_CHANNEL — 视频号内容.html（发布标题/发布内容/口播稿）+ 视频封面.png，独立封面，只取材自 video_script（见 generateVideoCover）。 */
async function buildVideoPackage(
  zip: JSZip,
  supabase: SupabaseServerClient,
  assets: ContentAsset[],
  folderPrefix: string,
): Promise<PlatformZipResult> {
  const asset = getLatestForLineage(assets, "VIDEO_CHANNEL", "video_script");
  if (!asset) return { foundAny: false, problems: [`${folderPrefix}视频号：内容不存在`] };

  const problems: string[] = [];
  const c = asset.structured_content ?? {};
  const publishTitle = asText(c.publish_title);
  const publishCaption = asText(c.publish_caption);
  const fullScript = asText(c.full_script);
  if (!publishTitle) problems.push(`${folderPrefix}视频号：发布标题缺失`);
  if (!publishCaption) problems.push(`${folderPrefix}视频号：发布内容缺失`);
  if (!fullScript) problems.push(`${folderPrefix}视频号：口播稿缺失`);

  zip.file(
    `${folderPrefix}视频号内容.html`,
    renderSectionsAsHtml(asset.title, [
      { heading: "发布标题", body: publishTitle },
      { heading: "发布内容", body: publishCaption },
      { heading: "口播稿", body: fullScript },
    ]),
  );

  const hasCover = await downloadCoverInto(zip, supabase, asset.id, `${folderPrefix}视频封面`, `${folderPrefix}视频号`, problems);
  if (!hasCover) problems.push(`${folderPrefix}视频号：封面缺失`);

  return { foundAny: true, problems };
}

/** XIAOHONGSHU — 发布文案.html（发布标题/发布内容，来自 xiaohongshu_post）+ 图文/P1..Pn.png（来自 xiaohongshu_pages 的 carousel）。P1 即首图，不要求任何额外封面。 */
async function buildXiaohongshuPackage(
  zip: JSZip,
  supabase: SupabaseServerClient,
  assets: ContentAsset[],
  folderPrefix: string,
): Promise<PlatformZipResult> {
  const post = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  const pages = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_pages");
  const problems: string[] = [];
  if (!post) problems.push(`${folderPrefix}小红书：标题文案不存在`);
  if (!pages) problems.push(`${folderPrefix}小红书：图文规划不存在`);
  if (!post || !pages) return { foundAny: Boolean(post || pages), problems };

  zip.file(
    `${folderPrefix}发布文案.html`,
    renderSectionsAsHtml(post.title, [
      { heading: "发布标题", body: post.title },
      { heading: "发布内容", body: post.content },
    ]),
  );

  const { data: images, error: imagesError } = await supabase
    .from("content_images")
    .select("image_path, image_kind, page_index")
    .eq("content_asset_id", pages.id)
    .eq("image_kind", "carousel")
    .order("page_index", { ascending: true, nullsFirst: true });
  if (imagesError) {
    problems.push(`${folderPrefix}小红书：读取图片记录失败（${imagesError.message}）`);
    return { foundAny: true, problems };
  }

  let carouselDownloaded = 0;
  for (const image of images ?? []) {
    const { data: downloaded, error: downloadError } = await supabase.storage.from("content-images").download(image.image_path);
    if (!downloaded || downloadError) {
      problems.push(`${folderPrefix}小红书：第${image.page_index ?? "?"}页图片下载失败（${downloadError?.message ?? "未知错误"}）`);
      continue;
    }
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    const ext = image.image_path.split(".").pop() ?? "png";
    zip.file(`${folderPrefix}图文/P${image.page_index ?? "?"}.${ext}`, bytes);
    carouselDownloaded++;
  }

  // xiaohongshu_pages declares how many pages the plan has; cross-check
  // against how many carousel images actually made it into the zip —
  // catches both "P1 missing" and "some later Pn missing" (declared count
  // won't match actual count either way), instead of shipping a silently-
  // incomplete carousel. No cover check here (round 9 P0 fix) — 小红书
  // never generates or requires a separate cover, P1 is the 首图.
  const declaredPages = (pages.structured_content as { pages?: unknown[] } | null)?.pages?.length ?? 0;
  if (declaredPages > 0 && carouselDownloaded !== declaredPages) {
    problems.push(`${folderPrefix}小红书：图文规划共 ${declaredPages} 页，实际打包 ${carouselDownloaded} 页`);
  }

  return { foundAny: true, problems };
}

/** WECHAT_OFFICIAL_ACCOUNT — 公众号文章.html（标题 + 完整正文，已含结尾话术/品牌落款）+ 文章封面.png。 */
async function buildWechatPackage(
  zip: JSZip,
  supabase: SupabaseServerClient,
  assets: ContentAsset[],
  folderPrefix: string,
): Promise<PlatformZipResult> {
  const asset = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_article");
  if (!asset) return { foundAny: false, problems: [`${folderPrefix}公众号：内容不存在`] };

  const problems: string[] = [];
  // Use the already-stored title/content columns rather than recomputing
  // from structured_content — they were derived once, at save time, by
  // the same generation/revision code path that also deterministically
  // appends the WeChat brand footer (see content-mapping.ts's
  // deriveTitleAndContent + buildWechatBrandFooter). Recomputing here
  // would silently drop that footer, since it has no access to
  // brand_config at download time.
  zip.file(`${folderPrefix}公众号文章.html`, renderContentAsHtml(asset.title, asset.content));

  const hasCover = await downloadCoverInto(zip, supabase, asset.id, `${folderPrefix}文章封面`, `${folderPrefix}公众号`, problems);
  if (!hasCover) problems.push(`${folderPrefix}公众号：封面缺失`);

  return { foundAny: true, problems };
}

async function addPlatformToZip(
  zip: JSZip,
  supabase: SupabaseServerClient,
  assets: ContentAsset[],
  platform: ContentPlatform,
  folderPrefix: string,
): Promise<PlatformZipResult> {
  if (platform === "VIDEO_CHANNEL") return buildVideoPackage(zip, supabase, assets, folderPrefix);
  if (platform === "XIAOHONGSHU") return buildXiaohongshuPackage(zip, supabase, assets, folderPrefix);
  return buildWechatPackage(zip, supabase, assets, folderPrefix);
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
    if (!ALL_PLATFORMS.includes(platformParam as ContentPlatform)) {
      return new Response("Invalid platform.", { status: 400 });
    }
    const platform = platformParam as ContentPlatform;
    const result = await addPlatformToZip(zip, supabase, assets, platform, "");
    foundAny = result.foundAny;
    problems.push(...result.problems);
    filenameSuffix = CONTENT_PLATFORM_LABEL[platform];
  }

  // Fail closed: a partial zip (missing image, unreadable record, page
  // count mismatch, or a whole missing asset) is worse than no zip — the
  // operator could otherwise download an incomplete package and then hit
  // "完成，清空这条选题", permanently losing the only copy of what didn't
  // make it in. Checked before the generic "nothing found" 404 so a
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
