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
  generateVideoCover,
  generateWechatCover,
  generateXiaohongshuCarousel,
} from "../team/image-designer/actions";
import { getLatestLeoPortrait } from "@/lib/leo-portraits";
import type { ContentAsset, ContentPlatform, ContentType } from "@/lib/types";

/**
 * "选题确认之后，直接从内容到最后一步整合" + "工作的时候要加上百分比" (live
 * user instructions) — the steps below (content → 合规审核 → 校对 →
 * 终审复核 → 生图) are the granular building blocks a CLIENT component
 * (`src/components/generation-runner.tsx`, mounted on the home page)
 * calls one at a time via `useTransition`, so it can show which digital
 * employee is working, the full step sequence, and a live-ish percentage
 * between steps. Splitting these apart (rather than one big server-side
 * chain) is the whole point: a plain `<form action>` has no way to report
 * progress mid-flight, but a client component awaiting several separate
 * calls can update state after each one completes.
 *
 * Round 9 P0 fix: 小红书图文规划 (`xiaohongshu_pages`) used to be its own
 * pipeline step between final verification and images — it is now part of
 * the content step (see runContentGenerationStep), so the P1–Pn page text
 * genuinely goes through compliance/revision/final verification like any
 * other formal content, instead of skipping that chain entirely.
 */

const PLATFORM_CONTENT_TYPES: Record<ContentPlatform, ContentType[]> = {
  VIDEO_CHANNEL: ["video_script"],
  XIAOHONGSHU: ["xiaohongshu_post", "xiaohongshu_pages"],
  WECHAT_OFFICIAL_ACCOUNT: ["wechat_article"],
};

/**
 * Scoped to `platforms` (live audit finding, round 7): this used to hard-
 * code all three platforms, so a "只选 VIDEO_CHANNEL" run's compliance/
 * revision steps would still touch whatever XIAOHONGSHU/WECHAT drafts
 * happened to already exist in content_assets — a stale platform never
 * selected for this run could still get reviewed, revised, or blocked on.
 * `platforms` should always be `run.platforms` (see generation-runner.tsx),
 * the one source of truth for what this generation run actually selected.
 *
 * XIAOHONGSHU maps to TWO lineages, not one (round 9 P0 fix): the
 * `xiaohongshu_pages` P1–Pn plan used to be produced by a separate
 * "planning" pipeline step positioned AFTER this function's callers
 * (compliance/revision/final verification), which meant the actual P1–Pn
 * page text was never reviewed, never eligible for revision, and never
 * re-checked by final verification — only the title/caption
 * (`xiaohongshu_post`) went through that chain. Both lineages are now
 * "formal content" from this function's point of view, so every caller
 * below automatically covers both without any change to their own logic.
 */
async function latestGeneratedAssets(topicId: string, platforms: ContentPlatform[]): Promise<ContentAsset[]> {
  const assets = await getContentAssets(topicId);
  return platforms
    .flatMap((platform) => PLATFORM_CONTENT_TYPES[platform].map((contentType) => getLatestForLineage(assets, platform, contentType)))
    .filter((asset): asset is ContentAsset => asset !== null);
}

/**
 * Step 1 — C/D/F generate the selected platforms' title/caption text
 * (existing "生成内容" batch, now scoped to whichever platforms the
 * operator picked — see PlatformChoiceRadios), and — when XIAOHONGSHU is
 * among the selected platforms — K writes the 小红书图文 P1–Pn page plan
 * as part of this same logical step (round 9 P0 fix: this used to be a
 * separate "planning" step positioned after compliance/revision/final
 * verification, which meant the P1–Pn page text skipped that entire
 * review chain — see latestGeneratedAssets's doc comment). The two run in
 * parallel; either one failing stops this step, same "isolate then fail
 * closed" pattern as runImageGenerationStep below. `since` (this run's
 * created_at) makes a retry skip whichever sub-task already succeeded in
 * this run — see generateContent's/generatePagesPlan's own doc comments.
 * `runId` additionally gives each an atomic claim (round 6) so two
 * concurrent requests can't both call the AI for the same sub-task.
 */
export async function runContentGenerationStep(topicId: string, platforms: ContentPlatform[], since?: string, runId?: string): Promise<void> {
  const tasks: { label: string; promise: Promise<void> }[] = [
    { label: "文案", promise: generateContent(topicId, platforms, since, runId) },
  ];
  if (platforms.includes("XIAOHONGSHU")) {
    tasks.push({
      label: "小红书图文规划",
      promise: generatePagesPlan(topicId, undefined, since, runId).then((result) => {
        if (!result.ok) throw new Error(result.error ?? "图文规划生成失败。");
      }),
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.promise));
  const failures = settled
    .map((result, i) => ({ label: tasks[i].label, result }))
    .filter(({ result }) => result.status === "rejected");
  if (failures.length > 0) {
    const detail = failures
      .map(({ label, result }) => `${label}：${(result as PromiseRejectedResult).reason instanceof Error ? (result as PromiseRejectedResult).reason.message : String((result as PromiseRejectedResult).reason)}`)
      .join("；");
    throw new Error(`内容生成失败：${detail}`);
  }
}

/**
 * Step 2 — E generates whichever images the selected platforms actually
 * need: an independent 视频号 cover (only if VIDEO_CHANNEL selected,
 * sourced only from video_script — see generateVideoCover's doc comment),
 * the 公众号 cover (only if selected), and the 小红书图文 carousel (only
 * if 小红书 selected — needs step 1's plan). Runs in parallel —
 * independent images, same "isolate the failure" principle as every other
 * step: one image failing never blocks the others. Round 9 P0 fix: 小红书
 * no longer gets any cover here — P1 of the carousel IS its 首图, and the
 * previously-shared 视频号/小红书 cover no longer exists (see
 * generateVideoCover's doc comment). Includes Leo's portrait in the video
 * cover automatically when one has been uploaded (live bug report: this
 * automated chain used to hardcode `includePortrait: false`, silently
 * skipping it every run even when a portrait existed — manual runs from
 * 图片设理员's own page still default to no portrait, since there it's a
 * deliberate per-click choice with its own checkbox).
 */
export async function runImageGenerationStep(topicId: string, platforms: ContentPlatform[], since?: string, runId?: string): Promise<void> {
  const portrait = await getLatestLeoPortrait();
  const tasks: { label: string; promise: Promise<{ ok: boolean; error?: string }> }[] = [];
  if (platforms.includes("VIDEO_CHANNEL")) {
    tasks.push({ label: "视频封面", promise: generateVideoCover(topicId, portrait !== null, undefined, since, runId) });
  }
  if (platforms.includes("WECHAT_OFFICIAL_ACCOUNT")) {
    tasks.push({ label: "公众号封面", promise: generateWechatCover(topicId, undefined, since, runId) });
  }
  if (platforms.includes("XIAOHONGSHU")) {
    tasks.push({ label: "小红书图文", promise: generateXiaohongshuCarousel(topicId, undefined, since, runId) });
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
async function computeAnyFlagged(topicId: string, platforms: ContentPlatform[]): Promise<boolean> {
  const latestAssets = await latestGeneratedAssets(topicId, platforms);
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
export async function runComplianceStep(
  topicId: string,
  platforms: ContentPlatform[],
  runId?: string,
): Promise<{ anyFlagged: boolean }> {
  const latestAssets = await latestGeneratedAssets(topicId, platforms);
  const reviews = await getComplianceReviews(topicId);
  const reviewedAssetIds = new Set(reviews.map((review) => review.content_asset_id));
  const pendingAssets = latestAssets.filter((asset) => !reviewedAssetIds.has(asset.id));

  const settled = await Promise.allSettled(pendingAssets.map((asset) => runComplianceReview(asset.id, undefined, runId)));

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

  const anyFlagged = await computeAnyFlagged(topicId, platforms);

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
export async function runRevisionStep(
  topicId: string,
  platforms: ContentPlatform[],
  runId?: string,
): Promise<{ skipped: boolean }> {
  const anyFlagged = await computeAnyFlagged(topicId, platforms);
  if (!anyFlagged) return { skipped: true };

  const latestAssets = await latestGeneratedAssets(topicId, platforms);
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

  const settled = await Promise.allSettled(flagged.map((asset) => reviseContentAsset(asset.id, undefined, runId)));
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

/**
 * Step 6 — G looks once more at whatever H just revised, before anything
 * moves on to planning/images/packaging (live user instruction: a revised
 * draft used to go straight into the rest of the pipeline with no one
 * checking whether the revision actually fixed the flagged issue). Only
 * ever reviews assets this run actually produced a NEW version of —
 * `content_assets`/`compliance_reviews` are the source of truth, not a
 * separate "did I already verify this" flag: a revised asset is a brand
 * new row with no review yet, so it's naturally selected by the same
 * "latest asset with no compliance_reviews row" filter runComplianceStep
 * uses; an asset revision never touched still has its original (already
 * LOW, or revision would have run) review and is naturally excluded. This
 * means a run where nothing was ever flagged does zero extra work here,
 * and a retry after this step already ran once doesn't re-review assets
 * it already reviewed.
 *
 * Stop rule: this NEVER calls reviseContentAsset again — a still-flagged
 * result after revision means a human needs to look, not another automatic
 * revision pass (that's exactly how compliance → revision → compliance →
 * revision loops happen). The final MEDIUM/HIGH check re-reads
 * compliance_reviews directly (not via the existing fail-open
 * getComplianceReviews helper — this is the one thing standing between
 * "pipeline says success" and "genuinely unresolved compliance risk", so a
 * read failure here must throw, not be silently swallowed into "looks
 * clean"). Checking every in-scope asset's CURRENT review (not just the
 * ones reviewed in this call) means a retry after a stop here re-derives
 * the same stop from the DB instead of silently passing once nothing is
 * newly "pending".
 */
export async function runFinalVerificationStep(
  topicId: string,
  platforms: ContentPlatform[],
  runId?: string,
): Promise<{ skipped: boolean }> {
  const latestAssets = await latestGeneratedAssets(topicId, platforms);
  const reviews = await getComplianceReviews(topicId);
  const reviewedAssetIds = new Set(reviews.map((review) => review.content_asset_id));
  const pendingAssets = latestAssets.filter((asset) => !reviewedAssetIds.has(asset.id));

  if (pendingAssets.length > 0) {
    const settled = await Promise.allSettled(pendingAssets.map((asset) => runComplianceReview(asset.id, undefined, runId)));
    const failures = settled
      .map((result, i) => ({ asset: pendingAssets[i], result }))
      .filter(({ result }) => result.status === "rejected" || !result.value.ok);
    if (failures.length > 0) {
      const detail = failures
        .map(
          ({ asset, result }) =>
            `${CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform}：${result.status === "rejected" ? String(result.reason) : (result.value.error ?? "复核失败")}`,
        )
        .join("；");
      throw new Error(`终审复核未能完成，已停止：${detail}`);
    }
  }

  if (latestAssets.length > 0) {
    const supabase = await createClient();
    const { data: freshReviews, error: freshReviewsError } = await supabase
      .from("compliance_reviews")
      .select("content_asset_id, overall_risk")
      .in(
        "content_asset_id",
        latestAssets.map((asset) => asset.id),
      )
      .order("created_at", { ascending: false });
    if (freshReviewsError) throw new Error(`终审复核结果读取失败，已停止：${freshReviewsError.message}`);

    const latestRiskByAssetId = new Map<string, string>();
    for (const review of freshReviews ?? []) {
      if (!latestRiskByAssetId.has(review.content_asset_id)) {
        latestRiskByAssetId.set(review.content_asset_id, review.overall_risk);
      }
    }

    const stillFlagged = latestAssets.filter((asset) => {
      const risk = latestRiskByAssetId.get(asset.id);
      return risk !== undefined && risk !== "LOW";
    });
    if (stillFlagged.length > 0) {
      const detail = stillFlagged.map((asset) => CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform).join("、");
      throw new Error(`终审复核发现问题仍未解决（${detail}），需要人工检查，已停止自动流程。`);
    }
  }

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/compliance");
  return { skipped: pendingAssets.length === 0 };
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

  // Race-safe (live audit finding, round 6): a plain SELECT-then-INSERT
  // let two concurrent requests each see "no run yet" and each INSERT
  // their own row. `UNIQUE(topic_id)` (migration 0028) plus an upsert
  // that ignores a conflicting insert closes that window atomically — the
  // loser's upsert inserts nothing (rather than erroring or overwriting),
  // and the follow-up select below reads back whichever row actually won.
  const { data: inserted, error: insertError } = await supabase
    .from("generation_runs")
    .upsert(
      { topic_id: topicId, platforms, status: "running", completed_steps: [] },
      { onConflict: "topic_id", ignoreDuplicates: true },
    )
    .select(GENERATION_RUN_COLUMNS);
  if (insertError) throw new Error(`无法开始生成流程，请重试：${insertError.message}`);
  if (inserted && inserted.length > 0) return toGenerationRun(inserted[0]);

  const { data: existing, error: selectError } = await supabase
    .from("generation_runs")
    .select(GENERATION_RUN_COLUMNS)
    .eq("topic_id", topicId)
    .maybeSingle();
  if (selectError) throw new Error(`读取生成进度失败，请重试：${selectError.message}`);
  if (!existing) throw new Error("无法读取生成进度，请重试。");
  return toGenerationRun(existing);
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
