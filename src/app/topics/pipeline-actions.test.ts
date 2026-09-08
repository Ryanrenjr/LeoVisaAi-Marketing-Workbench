import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentAsset, ComplianceReviewRow } from "@/lib/types";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canManageContentAssets: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/leo-portraits", () => ({ getLatestLeoPortrait: vi.fn().mockResolvedValue(null) }));
vi.mock("./content-actions", () => ({ generateContent: vi.fn() }));
vi.mock("./research-actions", () => ({ approveResearchOnly: vi.fn() }));
const generatePagesPlanMock = vi.fn();
vi.mock("../team/xiaohongshu-image-planner/actions", () => ({ generatePagesPlan: (...args: unknown[]) => generatePagesPlanMock(...args) }));
const generateCrossPlatformCoverMock = vi.fn();
const generateWechatCoverMock = vi.fn();
const generateXiaohongshuCarouselMock = vi.fn();
vi.mock("../team/image-designer/actions", () => ({
  generateCrossPlatformCover: (...args: unknown[]) => generateCrossPlatformCoverMock(...args),
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

import { runComplianceStep, runRevisionStep, runImageGenerationStep, runImagePlanningStep } from "./pipeline-actions";

function asset(platform: ContentAsset["platform"], contentType: ContentAsset["content_type"], version = 1): ContentAsset {
  return { id: `${platform}-${contentType}`, platform, content_type: contentType, version } as ContentAsset;
}

const VIDEO_ASSET = asset("VIDEO_CHANNEL", "video_script");
const XHS_ASSET = asset("XIAOHONGSHU", "xiaohongshu_post");
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

    await expect(runComplianceStep("topic-1")).rejects.toThrow(/合规审核未能完成/);
  });

  it("also stops when a review call rejects outright (not just returns ok:false)", async () => {
    runComplianceReviewMock.mockImplementation(async (assetId: string) => {
      if (assetId === VIDEO_ASSET.id) throw new Error("network error");
      return { ok: true };
    });
    getComplianceReviewsMock.mockResolvedValue([]);

    await expect(runComplianceStep("topic-1")).rejects.toThrow(/合规审核未能完成/);
  });

  it("succeeds and reports anyFlagged correctly when every review genuinely runs", async () => {
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([
      review(VIDEO_ASSET.id, "LOW"),
      review(XHS_ASSET.id, "HIGH"),
      review(WECHAT_ASSET.id, "LOW"),
    ]);

    const { anyFlagged } = await runComplianceStep("topic-1");
    expect(anyFlagged).toBe(true);
  });

  it("skips assets that already have a compliance_reviews row — retry after a partial failure doesn't re-review what already succeeded", async () => {
    // VIDEO and WECHAT already reviewed (e.g. from a first pass that then
    // failed on XHS); only XHS should actually be sent for review again.
    runComplianceReviewMock.mockResolvedValue({ ok: true });
    getComplianceReviewsMock.mockResolvedValue([review(VIDEO_ASSET.id, "LOW"), review(WECHAT_ASSET.id, "LOW")]);

    await runComplianceStep("topic-1");

    expect(runComplianceReviewMock).toHaveBeenCalledTimes(1);
    expect(runComplianceReviewMock).toHaveBeenCalledWith(XHS_ASSET.id);
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

    const result = await runRevisionStep("topic-1");
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

    const result = await runRevisionStep("topic-1");
    expect(result).toEqual({ skipped: false });
    expect(reviseContentAssetMock).toHaveBeenCalledTimes(1);
    expect(reviseContentAssetMock).toHaveBeenCalledWith(XHS_ASSET.id);
  });

  it("throws when a revision call fails, instead of silently leaving the flagged issue unresolved", async () => {
    getComplianceReviewsMock.mockResolvedValue([review(XHS_ASSET.id, "HIGH")]);
    reviseContentAssetMock.mockResolvedValue({ ok: false, error: "model refused" });

    await expect(runRevisionStep("topic-1")).rejects.toThrow(/校对修改失败/);
  });
});

describe("runImageGenerationStep — fail closed on a partial carousel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateCrossPlatformCoverMock.mockResolvedValue({ ok: true });
    generateWechatCoverMock.mockResolvedValue({ ok: true });
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
    generateXiaohongshuCarouselMock.mockResolvedValue({ ok: true, generated: 3 });

    await expect(runImageGenerationStep("topic-1", ["XIAOHONGSHU"])).resolves.toBeUndefined();
  });
});

describe("runImagePlanningStep — threads `since` through for retry idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes since through to generatePagesPlan as the third argument", async () => {
    generatePagesPlanMock.mockResolvedValue({ ok: true });

    await runImagePlanningStep("topic-1", "2026-01-01T00:00:00Z");

    expect(generatePagesPlanMock).toHaveBeenCalledWith("topic-1", undefined, "2026-01-01T00:00:00Z");
  });

  it("throws when generatePagesPlan reports failure (e.g. its own fail-closed idempotency check errored)", async () => {
    generatePagesPlanMock.mockResolvedValue({ ok: false, error: "检查图文规划是否已生成失败，请重试：connection reset" });

    await expect(runImagePlanningStep("topic-1", "2026-01-01T00:00:00Z")).rejects.toThrow(/检查图文规划是否已生成失败/);
  });
});
