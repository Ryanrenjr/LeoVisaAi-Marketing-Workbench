import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentAsset, ComplianceReviewRow } from "@/lib/types";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canManageContentAssets: () => true }));
/** Controls what `runFinalVerificationStep`'s fail-closed re-check of compliance_reviews sees — set per test via `freshReviewsResult`. */
let freshReviewsResult: { data: { content_asset_id: string; overall_risk: string }[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
function complianceReviewsChainable() {
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    order: () => Promise.resolve(freshReviewsResult),
  };
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => (table === "compliance_reviews" ? complianceReviewsChainable() : {}) }),
}));
vi.mock("@/lib/leo-portraits", () => ({ getLatestLeoPortrait: vi.fn().mockResolvedValue(null) }));
const generateContentMock = vi.fn();
vi.mock("./content-actions", () => ({ generateContent: (...args: unknown[]) => generateContentMock(...args) }));
vi.mock("./research-actions", () => ({ approveResearchOnly: vi.fn() }));
const generatePagesPlanMock = vi.fn();
vi.mock("../team/xiaohongshu-image-planner/actions", () => ({ generatePagesPlan: (...args: unknown[]) => generatePagesPlanMock(...args) }));
const generateVideoCoverMock = vi.fn();
const generateWechatCoverMock = vi.fn();
const generateXiaohongshuCarouselMock = vi.fn();
vi.mock("../team/image-designer/actions", () => ({
  generateVideoCover: (...args: unknown[]) => generateVideoCoverMock(...args),
  generateWechatCover: (...args: unknown[]) => generateWechatCoverMock(...args),
  generateXiaohongshuCarousel: (...args: unknown[]) => generateXiaohongshuCarouselMock(...args),
}));

const getContentAssetsMock = vi.fn();
const getComplianceReviewsMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getContentAssets: (...args: unknown[]) => getContentAssetsMock(...args),
  getComplianceReviews: (...args: unknown[]) => getComplianceReviewsMock(...args),
}));

const runComplianceReviewMock = vi.fn();
vi.mock("./compliance-actions", () => ({ runComplianceReview: (...args: unknown[]) => runComplianceReviewMock(...args) }));

const reviseContentAssetMock = vi.fn();
vi.mock("./revision-actions", () => ({ reviseContentAsset: (...args: unknown[]) => reviseContentAssetMock(...args) }));

import {
  runComplianceStep,
  runRevisionStep,
  runFinalVerificationStep,
  runImageGenerationStep,
  runContentGenerationStep,
} from "./pipeline-actions";
import type { ContentPlatform } from "@/lib/types";

const ALL_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

function asset(platform: ContentAsset["platform"], contentType: ContentAsset["content_type"], version = 1): ContentAsset {
  return { id: `${platform}-${contentType}`, platform, content_type: contentType, version } as ContentAsset;
}

const VIDEO_ASSET = asset("VIDEO_CHANNEL", "video_script");
const XHS_ASSET = asset("XIAOHONGSHU", "xiaohongshu_post");
const XHS_PAGES_ASSET = asset("XIAOHONGSHU", "xiaohongshu_pages");
const WECHAT_ASSET = asset("WECHAT_OFFICIAL_ACCOUNT", "wechat_article");

function review(assetId: string, risk: ComplianceReviewRow["overall_risk"]): ComplianceReviewRow {
  return { id: `review-${assetId}`, content_asset_id: assetId, overall_risk: risk } as ComplianceReviewRow;
}

describe("runComplianceStep — fail closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentAssetsMock.mockResolvedValue([VIDEO_ASSET, XHS_ASSET, WECHAT_ASSET]);
  });

  it("throws instead of proceeding when a compliance call fails, never silently treating it as LOW risk", async () => {
    runComplianceReviewMock.mockImplementation(async (assetId: string) => {
      if (assetId === XHS_ASSET.id) return { ok: false, error: "model timeout" };
      return { ok: true };
    });
    getComplianceReviewsMock.mockResolvedValue([]); // the failed call never wrote a row

    await expect(runComplianceStep("topic-1", ALL_PLATFORMS)).rejects.toThrow(/合规审核未能完成/);
  });

  it("also stops when a review call rejects outright (not just returns ok:false)", async () => {
    runComplianceReviewMock.mockImplementation(async (assetId: string) => {
      if (assetId === VIDEO_ASSET.id) throw new Error("network error");
      return { ok: true };
    });
    getComplianceReviewsMock.mockResolvedValue([]);

    await expect(runComplianceStep("topic-1", ALL_PLATFORMS)).rejects.toThrow(/合规审核未能完成/);
  });

  it("succeeds and reports anyFlagged correctly when every review genuinely runs", async () => {
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([
      review(VIDEO_ASSET.id, "LOW"),
      review(XHS_ASSET.id, "HIGH"),
      review(WECHAT_ASSET.id, "LOW"),
    ]);

    const { anyFlagged } = await runComplianceStep("topic-1", ALL_PLATFORMS);
    expect(anyFlagged).toBe(true);
  });

  it("skips assets that already have a compliance_reviews row — retry after a partial failure doesn't re-review what already succeeded", async () => {
    // VIDEO and WECHAT already reviewed (e.g. from a first pass that then
    // failed on XHS); only XHS should actually be sent for review again.
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([review(VIDEO_ASSET.id, "LOW"), review(WECHAT_ASSET.id, "LOW")]);

    await runComplianceStep("topic-1", ALL_PLATFORMS);

    expect(runComplianceReviewMock).toHaveBeenCalledTimes(1);
    expect(runComplianceReviewMock).toHaveBeenCalledWith(XHS_ASSET.id, undefined, undefined);
  });

  /**
   * Round 9 P0 fix: `xiaohongshu_pages` (K's P1–Pn plan) used to be
   * produced by a separate "planning" step positioned AFTER this one, so
   * it never went through compliance at all. It's now folded into the
   * content step and must be reviewed exactly like xiaohongshu_post.
   */
  it("reviews BOTH xiaohongshu_post and xiaohongshu_pages when XIAOHONGSHU is selected — the page plan is no longer skipped", async () => {
    getContentAssetsMock.mockResolvedValue([XHS_ASSET, XHS_PAGES_ASSET]);
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([]);

    await runComplianceStep("topic-1", ["XIAOHONGSHU"]);

    expect(runComplianceReviewMock).toHaveBeenCalledTimes(2);
    expect(runComplianceReviewMock).toHaveBeenCalledWith(XHS_ASSET.id, undefined, undefined);
    expect(runComplianceReviewMock).toHaveBeenCalledWith(XHS_PAGES_ASSET.id, undefined, undefined);
  });
});

describe("runRevisionStep — resume-safe (re-derives from DB, not client-passed state)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentAssetsMock.mockResolvedValue([VIDEO_ASSET, XHS_ASSET, WECHAT_ASSET]);
  });

  it("reports skipped:true when nothing is flagged, without calling reviseContentAsset", async () => {
    getComplianceReviewsMock.mockResolvedValue([
      review(VIDEO_ASSET.id, "LOW"),
      review(XHS_ASSET.id, "LOW"),
      review(WECHAT_ASSET.id, "LOW"),
    ]);

    const result = await runRevisionStep("topic-1", ALL_PLATFORMS);
    expect(result).toEqual({ skipped: true });
    expect(reviseContentAssetMock).not.toHaveBeenCalled();
  });

  it("revises only the flagged platform when compliance state shows a real issue — correct even with no prior in-memory context (the resume scenario)", async () => {
    getComplianceReviewsMock.mockResolvedValue([
      review(VIDEO_ASSET.id, "LOW"),
      review(XHS_ASSET.id, "HIGH"),
      review(WECHAT_ASSET.id, "LOW"),
    ]);
    reviseContentAssetMock.mockResolvedValue({ ok: true });

    const result = await runRevisionStep("topic-1", ALL_PLATFORMS);
    expect(result).toEqual({ skipped: false });
    expect(reviseContentAssetMock).toHaveBeenCalledTimes(1);
    expect(reviseContentAssetMock).toHaveBeenCalledWith(XHS_ASSET.id, undefined, undefined);
  });

  it("throws when a revision call fails, instead of silently leaving the flagged issue unresolved", async () => {
    getComplianceReviewsMock.mockResolvedValue([review(XHS_ASSET.id, "HIGH")]);
    reviseContentAssetMock.mockResolvedValue({ ok: false, error: "model refused" });

    await expect(runRevisionStep("topic-1", ALL_PLATFORMS)).rejects.toThrow(/校对修改失败/);
  });
});

/**
 * Round 9 P0 fix: 小红书图文规划 (K's P1–Pn page plan) no longer generates
 * any cover, and neither does 视频号 share one with it any more —
 * `generateVideoCover` only ever runs for VIDEO_CHANNEL, and XIAOHONGSHU
 * only ever calls the carousel generator, never any cover function.
 */
describe("runImageGenerationStep — per-platform dispatch, no shared cover, fail closed on a partial carousel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateVideoCoverMock.mockResolvedValue({ ok: true });
    generateWechatCoverMock.mockResolvedValue({ ok: true });
    generateXiaohongshuCarouselMock.mockResolvedValue({ ok: true, generated: 3 });
  });

  it("only calls generateVideoCover when VIDEO_CHANNEL is the only selected platform — no XIAOHONGSHU/WECHAT calls", async () => {
    await runImageGenerationStep("topic-1", ["VIDEO_CHANNEL"]);

    expect(generateVideoCoverMock).toHaveBeenCalledTimes(1);
    expect(generateWechatCoverMock).not.toHaveBeenCalled();
    expect(generateXiaohongshuCarouselMock).not.toHaveBeenCalled();
  });

  it("only calls generateXiaohongshuCarousel when XIAOHONGSHU is the only selected platform — never a cover function", async () => {
    await runImageGenerationStep("topic-1", ["XIAOHONGSHU"]);

    expect(generateXiaohongshuCarouselMock).toHaveBeenCalledTimes(1);
    expect(generateVideoCoverMock).not.toHaveBeenCalled();
    expect(generateWechatCoverMock).not.toHaveBeenCalled();
  });

  it("throws when generateXiaohongshuCarousel reports ok:false, even though some pages generated", async () => {
    // Live audit finding (P0, round 3): the carousel generator used to
    // report ok:(generated > 0), which meant a partial failure (e.g. 1 of 3
    // pages) looked like success here — this step's !result.value.ok check
    // only works if the generator itself is honest about partial failure.
    generateXiaohongshuCarouselMock.mockResolvedValue({ ok: false, error: "page 2 failed", generated: 1 });

    await expect(runImageGenerationStep("topic-1", ["XIAOHONGSHU"])).rejects.toThrow(/配图生成失败/);
  });

  it("succeeds when every task genuinely reports ok:true", async () => {
    await expect(runImageGenerationStep("topic-1", ["XIAOHONGSHU"])).resolves.toBeUndefined();
  });

  it("runs all three tasks in parallel when every platform is selected", async () => {
    await runImageGenerationStep("topic-1", ALL_PLATFORMS);

    expect(generateVideoCoverMock).toHaveBeenCalledTimes(1);
    expect(generateWechatCoverMock).toHaveBeenCalledTimes(1);
    expect(generateXiaohongshuCarouselMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Round 9 P0 fix: 小红书图文规划 (`xiaohongshu_pages`) used to be produced
 * by a separate "planning" pipeline step positioned after compliance/
 * revision/final verification. It's now part of this same content step,
 * so its P1–Pn page text actually goes through review — see
 * latestGeneratedAssets's doc comment in pipeline-actions.ts.
 */
describe("runContentGenerationStep — folds 小红书图文规划 into the content step for XIAOHONGSHU", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls only generateContent when XIAOHONGSHU is not selected", async () => {
    generateContentMock.mockResolvedValue(undefined);

    await runContentGenerationStep("topic-1", ["VIDEO_CHANNEL"], "2026-01-01T00:00:00Z", "run-1");

    expect(generateContentMock).toHaveBeenCalledWith("topic-1", ["VIDEO_CHANNEL"], "2026-01-01T00:00:00Z", "run-1");
    expect(generatePagesPlanMock).not.toHaveBeenCalled();
  });

  it("calls both generateContent and generatePagesPlan in parallel when XIAOHONGSHU is selected", async () => {
    generateContentMock.mockResolvedValue(undefined);
    generatePagesPlanMock.mockResolvedValue({ ok: true });

    await runContentGenerationStep("topic-1", ["XIAOHONGSHU"], "2026-01-01T00:00:00Z", "run-1");

    expect(generateContentMock).toHaveBeenCalledWith("topic-1", ["XIAOHONGSHU"], "2026-01-01T00:00:00Z", "run-1");
    expect(generatePagesPlanMock).toHaveBeenCalledWith("topic-1", undefined, "2026-01-01T00:00:00Z", "run-1");
  });

  it("throws when generateContent rejects, even if generatePagesPlan succeeds", async () => {
    generateContentMock.mockRejectedValue(new Error("内容生成失败：视频号：model timeout"));
    generatePagesPlanMock.mockResolvedValue({ ok: true });

    await expect(runContentGenerationStep("topic-1", ["XIAOHONGSHU"])).rejects.toThrow(/内容生成失败/);
  });

  it("throws when generatePagesPlan reports ok:false, even if generateContent succeeds", async () => {
    generateContentMock.mockResolvedValue(undefined);
    generatePagesPlanMock.mockResolvedValue({ ok: false, error: "检查图文规划是否已生成失败，请重试：connection reset" });

    await expect(runContentGenerationStep("topic-1", ["XIAOHONGSHU"])).rejects.toThrow(/检查图文规划是否已生成失败/);
  });
});

function assetWithId(id: string, platform: ContentAsset["platform"], contentType: ContentAsset["content_type"], version: number): ContentAsset {
  return { id, platform, content_type: contentType, version } as ContentAsset;
}

/**
 * Live audit finding (round 7): a revised draft (H's output) never got a
 * second look before moving on to planning/images/packaging. These tests
 * cover the new final-verification step: it must only ever review assets
 * this run actually produced a new version of, must never call
 * reviseContentAsset itself (that's exactly how a compliance -> revision
 * -> compliance -> revision loop would happen), and must stop the whole
 * pipeline — not silently continue — when the revised version is still
 * flagged.
 */
describe("runFinalVerificationStep — reviews only newly revised assets, never auto-revises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freshReviewsResult = { data: [], error: null };
  });

  it("continues without throwing when the revised version's review comes back LOW", async () => {
    const revised = assetWithId("xhs-v2", "XIAOHONGSHU", "xiaohongshu_post", 2);
    getContentAssetsMock.mockResolvedValue([revised]);
    getComplianceReviewsMock.mockResolvedValue([]); // the new version has no review yet — pending
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    freshReviewsResult = { data: [{ content_asset_id: "xhs-v2", overall_risk: "LOW" }], error: null };

    const result = await runFinalVerificationStep("topic-1", ["XIAOHONGSHU"]);

    expect(result).toEqual({ skipped: false });
    expect(runComplianceReviewMock).toHaveBeenCalledTimes(1);
    expect(runComplianceReviewMock).toHaveBeenCalledWith("xhs-v2", undefined, undefined);
    expect(reviseContentAssetMock).not.toHaveBeenCalled();
  });

  it("stops the pipeline (throws) instead of continuing when the revised version is still MEDIUM/HIGH, and never auto-revises again", async () => {
    const revised = assetWithId("xhs-v2", "XIAOHONGSHU", "xiaohongshu_post", 2);
    getContentAssetsMock.mockResolvedValue([revised]);
    getComplianceReviewsMock.mockResolvedValue([]);
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    freshReviewsResult = { data: [{ content_asset_id: "xhs-v2", overall_risk: "HIGH" }], error: null };

    await expect(runFinalVerificationStep("topic-1", ["XIAOHONGSHU"])).rejects.toThrow(/终审复核发现问题仍未解决/);
    expect(reviseContentAssetMock).not.toHaveBeenCalled();
  });

  it("does nothing (no AI call) when revision never ran — the original asset already has its LOW review", async () => {
    const original = asset("XIAOHONGSHU", "xiaohongshu_post"); // id "XIAOHONGSHU-xiaohongshu_post", version 1
    getContentAssetsMock.mockResolvedValue([original]);
    getComplianceReviewsMock.mockResolvedValue([review(original.id, "LOW")]); // already reviewed, nothing pending
    freshReviewsResult = { data: [{ content_asset_id: original.id, overall_risk: "LOW" }], error: null };

    const result = await runFinalVerificationStep("topic-1", ["XIAOHONGSHU"]);

    expect(result).toEqual({ skipped: true });
    expect(runComplianceReviewMock).not.toHaveBeenCalled();
  });

  it("fails closed (throws) when the fresh compliance_reviews re-check itself errors, instead of assuming everything is clean", async () => {
    const original = asset("XIAOHONGSHU", "xiaohongshu_post");
    getContentAssetsMock.mockResolvedValue([original]);
    getComplianceReviewsMock.mockResolvedValue([review(original.id, "LOW")]);
    freshReviewsResult = { data: null, error: { message: "connection reset" } };

    await expect(runFinalVerificationStep("topic-1", ["XIAOHONGSHU"])).rejects.toThrow(/终审复核结果读取失败/);
  });
});

/**
 * Live audit finding (round 7): compliance/revision used to hard-code all
 * three platforms — a run that only selected VIDEO_CHANNEL would still
 * pull in whatever XIAOHONGSHU/WECHAT drafts happened to already exist in
 * content_assets. These confirm the `platforms` parameter genuinely scopes
 * which assets get touched, not just which ones get generated.
 */
describe("selected-platform isolation — compliance/revision never touch platforms outside the run's selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContentAssetsMock.mockResolvedValue([VIDEO_ASSET, XHS_ASSET, WECHAT_ASSET]);
  });

  it("runComplianceStep only reviews VIDEO_CHANNEL's asset when only VIDEO_CHANNEL is selected, even though XHS/WeChat drafts exist", async () => {
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([]);

    await runComplianceStep("topic-1", ["VIDEO_CHANNEL"]);

    expect(runComplianceReviewMock).toHaveBeenCalledTimes(1);
    expect(runComplianceReviewMock).toHaveBeenCalledWith(VIDEO_ASSET.id, undefined, undefined);
  });

  it("runRevisionStep never revises XHS/WeChat when only VIDEO_CHANNEL is selected, even if their reviews are flagged", async () => {
    getComplianceReviewsMock.mockResolvedValue([
      review(VIDEO_ASSET.id, "HIGH"),
      review(XHS_ASSET.id, "HIGH"),
      review(WECHAT_ASSET.id, "HIGH"),
    ]);
    reviseContentAssetMock.mockResolvedValue({ ok: true });

    await runRevisionStep("topic-1", ["VIDEO_CHANNEL"]);

    expect(reviseContentAssetMock).toHaveBeenCalledTimes(1);
    expect(reviseContentAssetMock).toHaveBeenCalledWith(VIDEO_ASSET.id, undefined, undefined);
  });
});
