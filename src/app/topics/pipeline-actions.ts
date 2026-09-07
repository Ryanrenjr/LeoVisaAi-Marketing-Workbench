"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContentAssets, getComplianceReviews } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { generateContent } from "./content-actions";
import { runComplianceReview } from "./compliance-actions";
import { reviseContentAsset } from "./revision-actions";
import { approveResearchOnly } from "./research-actions";
import { generatePagesPlan } from "../team/xiaohongshu-image-planner/actions";
import {
  generateCrossPlatformCover,
  generateWechatCover,
  generateXiaohongshuCarousel,
} from "../team/image-designer/actions";
import { getLatestLeoPortrait } from "@/lib/leo-portraits";
import type { ContentAsset, ContentPlatform, ContentType } from "@/lib/types";

/**
 * "选题确认之后，直接从内容到最后一步整合" + "工作的时候要加上百分比，图文
 * 规划也要加进去，生图也要加上，封面所有的" (live user instructions) — the
 * five steps below (content → 图文规划 → 生图 → 合规审核 → 校对) are the
 * granular building blocks a CLIENT component
 * (`src/components/generation-runner.tsx`, mounted on the home page)
 * calls one at a time via `useTransition`, so it can show which digital
 * employee is working, the full step sequence, and a live-ish percentage
 * between steps. Splitting these apart (rather than one big server-side
 * chain) is the whole point: a plain `<form action>` has no way to report
 * progress mid-flight, but a client component awaiting five separate
 * calls can update state after each one completes.
 */

const PLATFORM_CONTENT_TYPE: Record<
  ContentPlatform,
  Extract<ContentType, "video_script" | "xiaohongshu_post" | "wechat_article">
> = {
  VIDEO_CHANNEL: "video_script",
  XIAOHONGSHU: "xiaohongshu_post",
  WECHAT_OFFICIAL_ACCOUNT: "wechat_article",
};

async function latestGeneratedAssets(topicId: string): Promise<ContentAsset[]> {
  const assets = await getContentAssets(topicId);
  const platforms: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];
  return platforms
    .map((platform) => getLatestForLineage(assets, platform, PLATFORM_CONTENT_TYPE[platform]))
    .filter((asset): asset is ContentAsset => asset !== null);
}

/** Step 1 — C/D/E generate the selected platforms' text at once (existing "生成内容" batch, now scoped to whichever platforms the operator picked — see PlatformChoiceRadios). */
export async function runContentGenerationStep(topicId: string, platforms: ContentPlatform[]): Promise<void> {
  await generateContent(topicId, platforms);
}

/** Step 2 — K writes the 小红书图文 P1–Pn page plan, independent of D's title/caption. Feeds step 3's carousel generation. Only ever called when 小红书 is among the selected platforms (see generation-runner.tsx's buildSteps). */
export async function runImagePlanningStep(topicId: string): Promise<void> {
  await generatePagesPlan(topicId);
}

/**
 * Step 3 — F generates whichever images the selected platforms actually
 * need: the shared 视频号/小红书 cover (only if either of those two is
 * selected), the 公众号 cover (only if selected), and the 小红书图文
 * carousel (only if 小红书 selected — needs step 2's plan). Runs in
 * parallel — independent images, same "isolate the failure" principle as
 * every other step: one image failing never blocks the others. Includes
 * Leo's portrait in the shared cover automatically when one has been
 * uploaded (live bug report: this automated chain used to hardcode
 * `includePortrait: false`, silently skipping it every run even when a
 * portrait existed — manual runs from 图片设理员's own page still default
 * to no portrait, since there it's a deliberate per-click choice with its
 * own checkbox).
 */
export async function runImageGenerationStep(topicId: string, platforms: ContentPlatform[]): Promise<void> {
  const portrait = await getLatestLeoPortrait();
  const tasks: Promise<unknown>[] = [];
  if (platforms.includes("VIDEO_CHANNEL") || platforms.includes("XIAOHONGSHU")) {
    tasks.push(generateCrossPlatformCover(topicId, portrait !== null));
  }
  if (platforms.includes("WECHAT_OFFICIAL_ACCOUNT")) {
    tasks.push(generateWechatCover(topicId));
  }
  if (platforms.includes("XIAOHONGSHU")) {
    tasks.push(generateXiaohongshuCarousel(topicId));
  }
  await Promise.allSettled(tasks);
}

/** Step 4 — G runs compliance on every platform's latest draft. Returns whether anything came back non-LOW, so the client knows whether a revision step follows. */
export async function runComplianceStep(topicId: string): Promise<{ anyFlagged: boolean }> {
  const latestAssets = await latestGeneratedAssets(topicId);
  await Promise.allSettled(latestAssets.map((asset) => runComplianceReview(asset.id)));

  const reviews = await getComplianceReviews(topicId);
  const latestReviewByAssetId = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    if (!latestReviewByAssetId.has(review.content_asset_id)) {
      latestReviewByAssetId.set(review.content_asset_id, review);
    }
  }

  const anyFlagged = latestAssets.some((asset) => {
    const review = latestReviewByAssetId.get(asset.id);
    return review && review.overall_risk !== "LOW";
  });

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/compliance");
  return { anyFlagged };
}

/** Step 5 — H auto-revises every platform whose latest compliance review came back non-LOW. Never auto-approves anything: the revised draft still needs Leo's own look. */
export async function runRevisionStep(topicId: string): Promise<void> {
  const latestAssets = await latestGeneratedAssets(topicId);
  const reviews = await getComplianceReviews(topicId);
  const latestReviewByAssetId = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    if (!latestReviewByAssetId.has(review.content_asset_id)) {
      latestReviewByAssetId.set(review.content_asset_id, review);
    }
  }

  const flagged = latestAssets.filter((asset) => {
    const review = latestReviewByAssetId.get(asset.id);
    return review && review.overall_risk !== "LOW";
  });

  await Promise.allSettled(flagged.map((asset) => reviseContentAsset(asset.id)));

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/reviser");
  revalidatePath("/team/integrator");
}

const SELECTABLE_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

/**
 * Bound to both "通过" buttons (研究审阅页 + 选题详情页里嵌的那个), each
 * paired with `<PlatformChoiceRadios />` in the same `<form>` — Next.js
 * passes the submitted FormData as the final argument to a bound Server
 * Action automatically. Approves research (`approveResearchOnly` — no
 * redirect of its own, see its doc comment) and lands on the home page
 * with `?generating=<topicId>` (plus `&platforms=<ContentPlatform>` when
 * the operator picked a single platform instead of "一键全出" — omitted
 * for "ALL" so the URL/behavior for the default case is unchanged), where
 * `GenerationRunner` picks up and runs the steps above client-side,
 * showing progress. Since a topic is now always alone in the system
 * (nothing survives next to it — see CLAUDE.md rule 4), there's nothing
 * ambiguous about "which topic is generating."
 */
export async function approveAndGoHome(topicId: string, researchPackId: string, formData: FormData) {
  const approved = await approveResearchOnly(topicId, researchPackId);
  if (!approved) return;

  const choice = String(formData.get("platforms") ?? "ALL");
  const platformSuffix =
    choice !== "ALL" && SELECTABLE_PLATFORMS.includes(choice as ContentPlatform) ? `&platforms=${choice}` : "";

  redirect(`/?generating=${topicId}${platformSuffix}`);
}
