import "server-only";
import JSZip from "jszip";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { deriveTitleAndContent } from "@/lib/content-mapping";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import type { ContentPlatform, ContentType } from "@/lib/types";

/**
 * Employee I（内容整合员）"下载这个包" — zips one platform's latest text
 * draft(s) together with its images (cover, plus carousel pages for
 * Xiaohongshu's image-text plan) into a single file, since a browser
 * can't hand back an actual folder. Read-only: reuses exactly the same
 * data the integrator page already displays, no new generation, no
 * mutation. XIAOHONGSHU has two independent lineages (title/caption +
 * image-text plan, written by two different employees — live user
 * instruction) so both get included when present.
 */
const PLATFORM_CONTENT_TYPES: Record<ContentPlatform, { contentType: ContentType; label: string }[]> = {
  VIDEO_CHANNEL: [{ contentType: "video_script", label: "标题与正文" }],
  XIAOHONGSHU: [
    { contentType: "xiaohongshu_post", label: "标题与文案" },
    { contentType: "xiaohongshu_pages", label: "图文规划" },
  ],
  WECHAT_OFFICIAL_ACCOUNT: [{ contentType: "wechat_article", label: "标题与正文" }],
};

export async function GET(request: Request) {
  await requireUser();

  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get("topicId");
  const platform = searchParams.get("platform") as ContentPlatform | null;
  if (!topicId || !platform || !(platform in PLATFORM_CONTENT_TYPES)) {
    return new Response("Missing or invalid topicId/platform.", { status: 400 });
  }

  const topic = await getTopicById(topicId);
  if (!topic) return new Response("Topic not found.", { status: 404 });

  const assets = await getContentAssets(topicId);
  const supabase = await createClient();
  const zip = new JSZip();
  let foundAny = false;

  for (const { contentType, label } of PLATFORM_CONTENT_TYPES[platform]) {
    const asset = getLatestForLineage(assets, platform, contentType);
    if (!asset) continue;
    foundAny = true;

    const { data: images } = await supabase
      .from("content_images")
      .select("image_path, image_kind, page_index")
      .eq("content_asset_id", asset.id)
      .order("page_index", { ascending: true, nullsFirst: true });

    const { title, content } = deriveTitleAndContent(platform, asset.structured_content);
    const folder = PLATFORM_CONTENT_TYPES[platform].length > 1 ? `${label}/` : "";
    zip.file(`${folder}${label}.txt`, `${title}\n\n${content}`);

    for (const image of images ?? []) {
      const { data: downloaded } = await supabase.storage.from("content-images").download(image.image_path);
      if (!downloaded) continue;
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      const ext = image.image_path.split(".").pop() ?? "png";
      const filename =
        image.image_kind === "carousel"
          ? `${folder}图文/第${image.page_index ?? "?"}页.${ext}`
          : `${folder}封面.${ext}`;
      zip.file(filename, bytes);
    }
  }

  if (!foundAny) return new Response("No content for this platform yet.", { status: 404 });

  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const platformLabel = CONTENT_PLATFORM_LABEL[platform];
  const filename = `${topic.title}-${platformLabel}`.replace(/[\\/:*?"<>|]/g, "_");

  return new Response(new Uint8Array(zipBytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(filename)}.zip`,
    },
  });
}
