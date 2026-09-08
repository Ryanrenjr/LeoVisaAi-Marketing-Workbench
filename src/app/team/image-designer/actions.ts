"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { canManageContentAssets } from "@/lib/permissions";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { buildCoverImagePrompt, buildCarouselImagePrompt } from "@/lib/ai/image-generation";
import { getLatestLeoPortrait } from "@/lib/leo-portraits";
import { getBrandConfig } from "@/lib/brand-config";
import { runImageGenerationTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import { getEmployeeInstruction } from "@/lib/employee-instructions";
import { appendCustomInstructions } from "@/lib/ai/prompt-addendum";
import { saveGeneratedContentImage } from "@/lib/content-images";
import type { ModelRef } from "@/lib/ai/providers/types";
import type { ContentAsset } from "@/lib/types";

/**
 * 小红书/视频封面 — one cover image, built from whichever draft exists
 * (小红书 preferred when both exist, since that was this feature's
 * original scope; falls back to 视频号 otherwise). ADMIN-only, same gate
 * as every other content-generation action — produces a real, billable
 * image.
 *
 * Saved under BOTH platforms' content_asset_id when both drafts exist
 * (live bug report: it used to be saved only under whichever platform was
 * picked as `source`, so the OTHER platform's card always showed "封面：
 * 待生成" even though a shared cover had genuinely been generated) — see
 * `additionalAssetIds` on `saveGeneratedContentImage`.
 */
export async function generateCrossPlatformCover(
  topicId: string,
  includePortrait: boolean,
  override?: ModelRef | null,
  since?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };

  const assets = await getContentAssets(topicId);
  const xhsPost = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  const videoScript = getLatestForLineage(assets, "VIDEO_CHANNEL", "video_script");
  const source = xhsPost ?? videoScript;
  if (!source) return { ok: false, error: "请先生成小红书文字或视频口播稿，再生成封面。" };

  if (since && (await hasExistingImage(source.id, "cover", since))) return { ok: true };

  const other = source === xhsPost ? videoScript : xhsPost;
  const platformLabel = source === xhsPost ? "小红书" : "视频号";
  return runCoverGeneration(
    topic,
    source,
    platformLabel,
    user.id,
    override,
    includePortrait,
    other ? [other.id] : undefined,
  );
}

/**
 * 公众号封面 — same cover-generation logic, scoped to the WeChat draft
 * (article preferred, falling back to legacy outline/full-article
 * lineages). Landscape (1536x1024), not the portrait size used for
 * 视频号/小红书 — a WeChat article's cover is a wide banner shown above the
 * title, never a tall vertical card (live bug report: this was generating
 * at the same 1024x1536 portrait size as every other cover, which is the
 * wrong aspect ratio here).
 */
export async function generateWechatCover(
  topicId: string,
  override?: ModelRef | null,
  since?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };

  const assets = await getContentAssets(topicId);
  const article = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_article");
  const outline = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline");
  const fullArticle = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_full_article");
  const source = article ?? fullArticle ?? outline;
  if (!source) return { ok: false, error: "请先生成公众号文章，再生成封面。" };

  if (since && (await hasExistingImage(source.id, "cover", since))) return { ok: true };

  return runCoverGeneration(topic, source, "公众号", user.id, override, false, undefined, "1536x1024", "landscape");
}

/** Idempotency check for retries (live audit finding: without this, retrying a failed step re-generates images that already succeeded, re-billing the image model). Checks the actual content_images table — the real source of truth — rather than a separate progress ledger that could drift from it. */
async function hasExistingImage(contentAssetId: string, imageKind: "cover" | "carousel", since: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_images")
    .select("id")
    .eq("content_asset_id", contentAssetId)
    .eq("image_kind", imageKind)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

async function runCoverGeneration(
  topic: { id: string; title: string; business: string },
  source: ContentAsset,
  platformLabel: string,
  userId: string,
  override?: ModelRef | null,
  includePortrait = false,
  additionalAssetIds?: string[],
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1536",
  orientation: "portrait" | "landscape" = "portrait",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  let referenceImages: { bytes: Buffer; mimeType: string; filename: string }[] | undefined;
  if (includePortrait) {
    const portrait = await getLatestLeoPortrait();
    if (!portrait) return { ok: false, error: "还没有上传过李尔王特写照片，请先在下方上传一张。" };
    const { data: downloaded, error: downloadError } = await supabase.storage
      .from("leo-portraits")
      .download(portrait.image_path);
    if (downloadError || !downloaded) return { ok: false, error: "读取特写照片失败，请重试。" };
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    referenceImages = [{ bytes, mimeType: downloaded.type || "image/png", filename: portrait.image_path }];
  }

  const [customInstructions, brandConfig] = await Promise.all([
    getEmployeeInstruction("image-designer"),
    getBrandConfig(),
  ]);
  const highlights = Array.isArray(source.structured_content?.cover_highlights)
    ? (source.structured_content.cover_highlights as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  const prompt = appendCustomInstructions(
    buildCoverImagePrompt(
      topic,
      { title: source.title, text: source.content },
      platformLabel,
      includePortrait,
      highlights,
      brandConfig.contentBrand,
      orientation,
    ),
    customInstructions,
  );
  const result = await runImageGenerationTask(prompt, override, referenceImages, size);

  if (isRouterResolutionFailure(result)) return { ok: false, error: result.error };

  const model = getModel(result.provider, result.modelId);
  await writeUsageLog(supabase, {
    workflow_type: "image_generation",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topic.id,
    platform: source.platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "IMAGE_GENERATION",
    digital_employee: TASK_TYPE_EMPLOYEE.IMAGE_GENERATION,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) return { ok: false, error: result.error ?? "生成失败。" };

  const [imageBase64] = result.data.images;
  const saved = await saveGeneratedContentImage(supabase, {
    topicId: topic.id,
    contentAssetId: source.id,
    additionalAssetIds,
    prompt,
    imageBase64,
    provider: result.provider,
    modelId: result.modelId,
    userId,
    imageKind: "cover",
    pageIndex: null,
  });
  if (!saved.ok) return saved;

  revalidatePath("/team/image-designer");
  return { ok: true };
}

/**
 * 小红书图文 — one image per page of K（小红书图文规划员）'s latest 图文规划
 * (xiaohongshu_pages: P1–Pn text plan), not the post's own title/caption
 * draft. Live user instruction: K only writes the plan (P1 是什么、P2 怎么
 * 设计……); 图片设计员 is the one with the "生成小红书图文" button that turns
 * that plan into P1–P6 images. Runs sequentially, not in parallel, so one
 * failure doesn't leave a half-finished, out-of-order set, and usage
 * logging stays one row per real call.
 */
export async function generateXiaohongshuCarousel(
  topicId: string,
  override?: ModelRef | null,
  since?: string,
): Promise<{ ok: boolean; error?: string; generated?: number }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };

  const assets = await getContentAssets(topicId);
  const plan = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_pages");
  if (!plan) return { ok: false, error: "请先请小红书图文规划员生成图文规划，再生成配图。" };

  const pages = (plan.structured_content?.pages as string[] | undefined) ?? [];
  if (pages.length === 0) return { ok: false, error: "这份图文规划没有分页内容。" };

  const customInstructions = await getEmployeeInstruction("image-designer");
  const supabase = await createClient();
  let generated = 0;

  // Idempotency for retries (live audit finding): if pages 1-3 already
  // generated successfully in this run and page 4 failed, a retry should
  // only redo page 4 onward — not re-bill for the pages that already
  // exist. `pageIndex` is 1-based (see saveGeneratedContentImage below).
  let alreadyDonePages = new Set<number>();
  if (since) {
    const { data: existingImages } = await supabase
      .from("content_images")
      .select("page_index")
      .eq("content_asset_id", plan.id)
      .eq("image_kind", "carousel")
      .gte("created_at", since);
    alreadyDonePages = new Set((existingImages ?? []).map((img) => img.page_index).filter((p): p is number => p !== null));
  }

  for (let i = 0; i < pages.length; i++) {
    if (alreadyDonePages.has(i + 1)) {
      generated++;
      continue;
    }
    const prompt = appendCustomInstructions(
      buildCarouselImagePrompt(
        topic,
        { title: plan.title },
        { text: pages[i], pageNumber: i + 1, totalPages: pages.length },
      ),
      customInstructions,
    );
    const result = await runImageGenerationTask(prompt, override);

    if (isRouterResolutionFailure(result)) {
      // `generated` still reflects how many pages made it — used by the
      // idempotency check above on a retry — but a partial carousel must
      // never report ok:true, or the pipeline treats it as a finished step
      // and moves straight on to compliance/integration with pages missing.
      return { ok: false, error: result.error, generated };
    }

    const model = getModel(result.provider, result.modelId);
    await writeUsageLog(supabase, {
      workflow_type: "image_generation",
      model_alias: `${result.provider}/${result.modelId}`,
      topic_id: topic.id,
      platform: "XIAOHONGSHU",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      latency_ms: result.latencyMs,
      success: result.ok,
      error: result.ok ? null : result.error,
      provider: result.provider,
      task_type: "IMAGE_GENERATION",
      digital_employee: TASK_TYPE_EMPLOYEE.IMAGE_GENERATION,
      pricing_type_at_execution: model?.pricingType ?? null,
    });

    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "生成失败。", generated };
    }

    const [imageBase64] = result.data.images;
    const saved = await saveGeneratedContentImage(supabase, {
      topicId: topic.id,
      contentAssetId: plan.id,
      prompt,
      imageBase64,
      provider: result.provider,
      modelId: result.modelId,
      userId: user.id,
      imageKind: "carousel",
      pageIndex: i + 1,
    });
    if (!saved.ok) return { ok: false, error: saved.error, generated };
    generated++;
  }

  revalidatePath("/team/image-designer");
  revalidatePath(`/topics/${topicId}`);
  return { ok: true, generated };
}

const ALLOWED_PORTRAIT_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024;

/**
 * ADMIN uploads a real photo of Leo — never AI-generated; it's later sent
 * as a reference image to the Images EDIT endpoint (see
 * generateOpenAIImageEdit in providers/openai-provider.ts). The second
 * narrow upload exception in this app (the first is Employee E's
 * performance screenshot) — see docs/security-boundaries.md.
 */
export async function uploadLeoPortrait(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const file = formData.get("photo");
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!(file instanceof File) || file.size === 0) return { error: "请选择一张照片。" };

  const ext = ALLOWED_PORTRAIT_MIME[file.type];
  if (!ext) return { error: "只支持 PNG / JPEG / WEBP 格式的照片。" };
  if (file.size > MAX_PORTRAIT_BYTES) return { error: "照片文件过大（上限 8MB）。" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const supabase = await createClient();
  const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("leo-portraits")
    .upload(path, bytes, { contentType: file.type });
  if (uploadError) return { error: "上传失败，请重试。" };

  const { error: insertError } = await supabase.from("leo_portraits").insert({
    image_path: path,
    label,
    created_by: user.id,
  });
  if (insertError) return { error: "照片已上传，但记录保存失败，请重试。" };

  revalidatePath("/team/image-designer");
  return { error: null };
}

export async function deleteLeoPortrait(id: string, imagePath: string): Promise<void> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const supabase = await createClient();
  await supabase.storage.from("leo-portraits").remove([imagePath]);
  await supabase.from("leo_portraits").delete().eq("id", id);

  revalidatePath("/team/image-designer");
}
