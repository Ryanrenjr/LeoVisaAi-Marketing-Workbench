"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageContentAssets } from "@/lib/permissions";
import { getContentAssets, getComplianceReviews } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
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

/** Step 1 — C/D/E generate the selected platforms' text at once (existing "生成内容" batch, now scoped to whichever platforms the operator picked — see PlatformChoiceRadios). `since` (this run's created_at) makes a retry skip platforms already generated in this run — see generateContent's doc comment. */
export async function runContentGenerationStep(topicId: string, platforms: ContentPlatform[], since?: string): Promise<void> {
  await generateContent(topicId, platforms, since);
}

/** Step 2 — K writes the 小红书图文 P1–Pn page plan, independent of D's title/caption. Feeds step 3's carousel generation. Only ever called when 小红书 is among the selected platforms (see generation-runner.tsx's buildSteps). */
export async function runImagePlanningStep(topicId: string): Promise<void> {
  const result = await generatePagesPlan(topicId);
  if (!result.ok) throw new Error(result.error ?? "图文规划生成失败。");
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
export async function runImageGenerationStep(topicId: string, platforms: ContentPlatform[], since?: string): Promise<void> {
  const portrait = await getLatestLeoPortrait();
  const tasks: { label: string; promise: Promise<{ ok: boolean; error?: string }> }[] = [];
  if (platforms.includes("VIDEO_CHANNEL") || platforms.includes("XIAOHONGSHU")) {
    tasks.push({ label: "封面", promise: generateCrossPlatformCover(topicId, portrait !== null, undefined, since) });
  }
  if (platforms.includes("WECHAT_OFFICIAL_ACCOUNT")) {
    tasks.push({ label: "公众号封面", promise: generateWechatCover(topicId, undefined, since) });
  }
  if (platforms.includes("XIAOHONGSHU")) {
    tasks.push({ label: "小红书图文", promise: generateXiaohongshuCarousel(topicId, undefined, since) });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.promise));
  // A silently-discarded {ok:false} here used to mean "配图少生成两张，前端
  // 100%完成" — every failure now stops the pipeline instead of being
  // treated as a no-op success.
  const failures = settled
    .map((result, i) => ({ label: tasks[i].label, result }))
    .filter(({ result }) => result.status === "rejected" || !result.value.ok);
  if (failures.length > 0) {
    const detail = failures
      .map(({ label, result }) => `${label}：${result.status === "rejected" ? String(result.reason) : (result.value.error ?? "生成失败")}`)
      .join("；");
    throw new Error(`配图生成失败：${detail}`);
  }
}

/**
 * Reads the current (already-persisted) compliance state for whatever
 * platforms actually have drafts — shared by runComplianceStep (right
 * after it runs compliance) and runRevisionStep (which now determines
 * for itself whether it has anything to do, rather than trusting a value
 * handed down from a sibling step — see runRevisionStep's doc comment for
 * why that mattered).
 */
async function computeAnyFlagged(topicId: string): Promise<boolean> {
  const latestAssets = await latestGeneratedAssets(topicId);
  const reviews = await getComplianceReviews(topicId);
  const latestReviewByAssetId = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    if (!latestReviewByAssetId.has(review.content_asset_id)) {
      latestReviewByAssetId.set(review.content_asset_id, review);
    }
  }
  return latestAssets.some((asset) => {
    const review = latestReviewByAssetId.get(asset.id);
    return review !== undefined && review.overall_risk !== "LOW";
  });
}

/**
 * Step 4 — G runs compliance on every platform's latest draft. A review
 * that fails to even run (router/model failure, not "found no issues")
 * must stop the pipeline here — the old code let a failed review silently
 * read back as "no compliance_reviews row → not flagged → skip revision",
 * which is indistinguishable from "reviewed and genuinely clean". Fail
 * closed instead: never LOW, never skip, just stop.
 */
export async function runComplianceStep(topicId: string): Promise<{ anyFlagged: boolean }> {
  const latestAssets = await latestGeneratedAssets(topicId);
  const reviews = await getComplianceReviews(topicId);
  const reviewedAssetIds = new Set(reviews.map((review) => review.content_asset_id));
  const pendingAssets = latestAssets.filter((asset) => !reviewedAssetIds.has(asset.id));

  const settled = await Promise.allSettled(pendingAssets.map((asset) => runComplianceReview(asset.id)));

  const failures = settled
    .map((result, i) => ({ asset: pendingAssets[i], result }))
    .filter(({ result }) => result.status === "rejected" || !result.value.ok);
  if (failures.length > 0) {
    const detail = failures
      .map(
        ({ asset, result }) =>
          `${CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform}：${result.status === "rejected" ? String(result.reason) : (result.value.error ?? "审核失败")}`,
      )
      .join("；");
    throw new Error(`合规审核未能完成，已停止：${detail}`);
  }

  const anyFlagged = await computeAnyFlagged(topicId);

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/compliance");
  return { anyFlagged };
}

/**
 * Step 5 — H auto-revises every platform whose latest compliance review
 * came back non-LOW. Never auto-approves anything: the revised draft
 * still needs Leo's own look. Determines for itself (via
 * computeAnyFlagged, re-reading the DB) whether there's anything flagged,
 * instead of trusting a value the caller computed earlier — a client-side
 * ref holding "did compliance find anything" doesn't survive a page
 * refresh, so on resume (see generation-runner.tsx) this step needs to be
 * correct standing alone, not dependent on what happened earlier in the
 * same browser session. Returns whether it actually had nothing to do, so
 * the UI can show "skipped" instead of guessing.
 */
export async function runRevisionStep(topicId: string): Promise<{ skipped: boolean }> {
  const anyFlagged = await computeAnyFlagged(topicId);
  if (!anyFlagged) return { skipped: true };

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
    return review !== undefined && review.overall_risk !== "LOW";
  });

  const settled = await Promise.allSettled(flagged.map((asset) => reviseContentAsset(asset.id)));
  const failures = settled
    .map((result, i) => ({ asset: flagged[i], result }))
    .filter(({ result }) => result.status === "rejected" || !result.value.ok);
  if (failures.length > 0) {
    const detail = failures
      .map(
        ({ asset, result }) =>
          `${CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform}：${result.status === "rejected" ? String(result.reason) : (result.value.error ?? "修改失败")}`,
      )
      .join("；");
    throw new Error(`校对修改失败：${detail}`);
  }

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/reviser");
  revalidatePath("/team/integrator");
  return { skipped: false };
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

export interface GenerationRun {
  id: string;
  platforms: ContentPlatform[];
  status: "running" | "done" | "failed";
  completedSteps: string[];
  error: string | null;
  /** Everything a subtask produces at or after this timestamp counts as "done in this run" — see the `since` params threaded through generateContent/runImageGenerationStep/runComplianceStep below. */
  createdAt: string;
}

const GENERATION_RUN_COLUMNS = "id, platforms, status, completed_steps, error, created_at";

function toGenerationRun(row: {
  id: string;
  platforms: unknown;
  status: string;
  completed_steps: string[] | null;
  error: string | null;
  created_at: string;
}): GenerationRun {
  return {
    id: row.id,
    platforms: row.platforms as ContentPlatform[],
    status: row.status as GenerationRun["status"],
    completedSteps: row.completed_steps ?? [],
    error: row.error,
    createdAt: row.created_at,
  };
}

async function requireGenerationRunAccess() {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");
}

/**
 * Persists generation progress so a refresh/crash/dropped-wifi mid-pipeline
 * resumes from where it left off instead of silently re-running (and
 * re-billing) every step from scratch — GenerationRunner calls this once on
 * mount, before starting any actual work. A topic only ever has one
 * meaningful run at a time (the "通过" button is only clickable once, from
 * RESEARCH_READY), so this always operates on "the run for this topic",
 * not a list. The row's own platforms (not whatever the caller passes in)
 * win once a run exists, so a mangled/stale `?platforms=` URL param can
 * never diverge from what's actually been recorded as in progress.
 *
 * Every generation_runs read/write in this file (this function and the
 * four below it) checks its own Supabase error and throws — a live audit
 * found the previous version let a failed write pass silently, which is
 * exactly how "AI call succeeded but the system forgot" happens: the
 * content is real and billed, but a refresh reads back a run that never
 * recorded it.
 */
export async function getOrCreateGenerationRun(topicId: string, platforms: ContentPlatform[]): Promise<GenerationRun> {
  await requireGenerationRunAccess();
  const supabase = await createClient();

  const { data: existing, error: selectError } = await supabase
    .from("generation_runs")
    .select(GENERATION_RUN_COLUMNS)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(`读取生成进度失败，请重试：${selectError.message}`);
  if (existing) return toGenerationRun(existing);

  const { data: created, error: insertError } = await supabase
    .from("generation_runs")
    .insert({ topic_id: topicId, platforms, status: "running", completed_steps: [] })
    .select(GENERATION_RUN_COLUMNS)
    .single();
  if (insertError || !created) throw new Error(`无法开始生成流程，请重试：${insertError?.message ?? ""}`);

  return toGenerationRun(created);
}

/** Called after each step actually executes (not when it's merely skipped) — see generation-runner.tsx. */
export async function markGenerationRunStep(runId: string, step: string): Promise<void> {
  await requireGenerationRunAccess();
  const supabase = await createClient();

  const { data: run, error: selectError } = await supabase
    .from("generation_runs")
    .select("completed_steps")
    .eq("id", runId)
    .single();
  if (selectError) throw new Error(`读取生成进度失败：${selectError.message}`);

  const completed = new Set<string>(run?.completed_steps ?? []);
  completed.add(step);
  const { error: updateError } = await supabase
    .from("generation_runs")
    .update({ completed_steps: Array.from(completed), updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (updateError) throw new Error(`记录生成进度失败：${updateError.message}`);
}

export async function completeGenerationRun(runId: string): Promise<void> {
  await requireGenerationRunAccess();
  const supabase = await createClient();
  const { error } = await supabase
    .from("generation_runs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw new Error(`标记生成完成失败：${error.message}`);
}

export async function failGenerationRun(runId: string, error: string): Promise<void> {
  await requireGenerationRunAccess();
  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("generation_runs")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (updateError) throw new Error(`记录失败状态失败：${updateError.message}`);
}

/**
 * "重试当前步骤" (live audit finding: a failed run had no way forward
 * except discarding the whole topic — a single 429/dropped connection
 * shouldn't be fatal). Resets status back to running and clears the
 * stored error; `completed_steps` is left exactly as-is, so resuming
 * picks up from the same point. Safe to call repeatedly.
 */
export async function retryGenerationRun(runId: string): Promise<GenerationRun> {
  await requireGenerationRunAccess();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generation_runs")
    .update({ status: "running", error: null, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .select(GENERATION_RUN_COLUMNS)
    .single();
  if (error || !data) throw new Error(`重试失败，请刷新页面再试：${error?.message ?? ""}`);
  return toGenerationRun(data);
}
