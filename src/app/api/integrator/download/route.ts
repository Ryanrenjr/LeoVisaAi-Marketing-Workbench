import "server-only";
import JSZip from "jszip";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { deriveTitleAndContent } from "@/lib/content-mapping";
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

async function addPlatformToZip(
  zip: JSZip,
  supabase: Awaited<ReturnType<typeof createClient>>,
  assets: ContentAsset[],
  platform: ContentPlatform,
  folderPrefix: string,
): Promise<boolean> {
  const contentTypes = PLATFORM_CONTENT_TYPES[platform];
  let foundAny = false;

  for (const { contentType, label } of contentTypes) {
    const asset = getLatestForLineage(assets, platform, contentType);
    if (!asset) continue;
    foundAny = true;

    const { data: images } = await supabase
      .from("content_images")
      .select("image_path, image_kind, page_index")
      .eq("content_asset_id", asset.id)
      .order("page_index", { ascending: true, nullsFirst: true });

    const { title, content } = deriveTitleAndContent(platform, asset.structured_content);
    const subfolder = contentTypes.length > 1 ? `${label}/` : "";
    zip.file(`${folderPrefix}${subfolder}${label}.txt`, `${title}\n\n${content}`);

    for (const image of images ?? []) {
      const { data: downloaded } = await supabase.storage.from("content-images").download(image.image_path);
      if (!downloaded) continue;
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      const ext = image.image_path.split(".").pop() ?? "png";
      const filename =
        image.image_kind === "carousel"
          ? `${folderPrefix}${subfolder}图文/第${image.page_index ?? "?"}页.${ext}`
          : `${folderPrefix}${subfolder}封面.${ext}`;
      zip.file(filename, bytes);
    }
  }

  return foundAny;
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

  if (!platformParam || platformParam === "all") {
    for (const platform of ALL_PLATFORMS) {
      const found = await addPlatformToZip(zip, supabase, assets, platform, `${CONTENT_PLATFORM_LABEL[platform]}/`);
      foundAny = foundAny || found;
    }
    filenameSuffix = "全部平台";
  } else {
    const platform = platformParam as ContentPlatform;
    if (!(platform in PLATFORM_CONTENT_TYPES)) {
      return new Response("Invalid platform.", { status: 400 });
    }
    foundAny = await addPlatformToZip(zip, supabase, assets, platform, "");
    filenameSuffix = CONTENT_PLATFORM_LABEL[platform];
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
