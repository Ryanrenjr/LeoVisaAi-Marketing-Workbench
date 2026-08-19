import { describe, expect, it } from "vitest";
import {
  getLatestForLineage,
  groupContentAssetsByLineage,
  groupSourcesByPackId,
  nextVersionNumber,
  sourcesForAsset,
} from "./content-versions";
import type { ContentAsset, ResearchSource } from "./types";

function makeAsset(overrides: Partial<ContentAsset>): ContentAsset {
  return {
    id: "id",
    topic_id: "topic-1",
    research_pack_id: "pack-1",
    platform: "VIDEO_CHANNEL",
    content_type: "video_script",
    title: "标题",
    content: "内容",
    structured_content: {},
    version: 1,
    status: "DRAFT",
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSource(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    id: "src",
    research_pack_id: "pack-1",
    title: "来源标题",
    url: "https://example.com",
    note: "",
    page_age: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("nextVersionNumber — version increments on regeneration", () => {
  it("starts a new lineage at version 1", () => {
    expect(nextVersionNumber([], "VIDEO_CHANNEL", "video_script")).toBe(1);
  });

  it("increments from the current max version in that lineage", () => {
    const assets = [makeAsset({ id: "v1", version: 1 }), makeAsset({ id: "v2", version: 2 })];
    expect(nextVersionNumber(assets, "VIDEO_CHANNEL", "video_script")).toBe(3);
  });

  it("does not let one platform's version count affect another's", () => {
    const assets = [
      makeAsset({ id: "video-v1", platform: "VIDEO_CHANNEL", content_type: "video_script", version: 1 }),
      makeAsset({ id: "video-v2", platform: "VIDEO_CHANNEL", content_type: "video_script", version: 2 }),
    ];
    expect(nextVersionNumber(assets, "XIAOHONGSHU", "xiaohongshu_post")).toBe(1);
  });

  it("keeps the WeChat outline and full-article lineages independent under the same platform", () => {
    const assets = [
      makeAsset({
        id: "outline-v1",
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        content_type: "wechat_outline",
        version: 1,
      }),
    ];
    expect(nextVersionNumber(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_full_article")).toBe(1);
    expect(nextVersionNumber(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline")).toBe(2);
  });
});

describe("getLatestForLineage", () => {
  it("returns null when nothing exists yet", () => {
    expect(getLatestForLineage([], "VIDEO_CHANNEL", "video_script")).toBeNull();
  });

  it("returns the highest-version asset regardless of array order", () => {
    const assets = [
      makeAsset({ id: "v2", version: 2 }),
      makeAsset({ id: "v1", version: 1 }),
      makeAsset({ id: "v3", version: 3 }),
    ];
    expect(getLatestForLineage(assets, "VIDEO_CHANNEL", "video_script")?.id).toBe("v3");
  });
});

describe("groupContentAssetsByLineage — previous versions remain accessible", () => {
  it("groups by (platform, content_type) and orders history newest first", () => {
    const assets = [
      makeAsset({ id: "video-v1", platform: "VIDEO_CHANNEL", content_type: "video_script", version: 1 }),
      makeAsset({ id: "video-v2", platform: "VIDEO_CHANNEL", content_type: "video_script", version: 2 }),
      makeAsset({ id: "xhs-v1", platform: "XIAOHONGSHU", content_type: "xiaohongshu_post", version: 1 }),
    ];
    const lineages = groupContentAssetsByLineage(assets);
    expect(lineages).toHaveLength(2);

    const video = lineages.find((l) => l.platform === "VIDEO_CHANNEL")!;
    expect(video.latest.id).toBe("video-v2");
    expect(video.history.map((a) => a.id)).toEqual(["video-v2", "video-v1"]);

    const xhs = lineages.find((l) => l.platform === "XIAOHONGSHU")!;
    expect(xhs.latest.id).toBe("xhs-v1");
    expect(xhs.history).toHaveLength(1);
  });

  it("returns an empty array for no assets", () => {
    expect(groupContentAssetsByLineage([])).toEqual([]);
  });
});

describe("groupSourcesByPackId / sourcesForAsset — content stays traceable to its own research pack", () => {
  it("groups sources under their own research_pack_id", () => {
    const sources = [
      makeSource({ id: "a", research_pack_id: "pack-v1" }),
      makeSource({ id: "b", research_pack_id: "pack-v1" }),
      makeSource({ id: "c", research_pack_id: "pack-v2" }),
    ];
    const byPack = groupSourcesByPackId(sources);
    expect(byPack.get("pack-v1")?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(byPack.get("pack-v2")?.map((s) => s.id)).toEqual(["c"]);
  });

  it("resolves an asset's sources using only its own research_pack_id", () => {
    const byPack = groupSourcesByPackId([
      makeSource({ id: "a", research_pack_id: "pack-v1" }),
      makeSource({ id: "b", research_pack_id: "pack-v2" }),
    ]);
    const asset = makeAsset({ research_pack_id: "pack-v1" });
    expect(sourcesForAsset(asset, byPack).map((s) => s.id)).toEqual(["a"]);
  });

  it("returns an empty array when no sources exist for that pack", () => {
    const byPack = groupSourcesByPackId([makeSource({ id: "a", research_pack_id: "pack-v1" })]);
    const asset = makeAsset({ research_pack_id: "pack-unrelated" });
    expect(sourcesForAsset(asset, byPack)).toEqual([]);
  });

  /**
   * The exact regression scenario: a topic's research gets re-run and
   * re-approved after content already exists. Content v1 (generated from
   * the OLD research pack) must keep showing only that pack's sources —
   * never the new one — even though the new pack is now the topic's
   * current/latest research pack. See docs/phase-4-plan.md.
   */
  it("REGRESSION: Content v1 generated from Research Pack v1 still shows only v1 sources after Research Pack v2 is later approved", () => {
    const packV1Source = makeSource({
      id: "v1-source",
      research_pack_id: "pack-v1",
      title: "V1 来源",
      url: "https://www.gov.uk/v1-source",
    });
    const packV2Source = makeSource({
      id: "v2-source",
      research_pack_id: "pack-v2",
      title: "V2 来源",
      url: "https://www.gov.uk/v2-source",
    });

    // Content v1 was generated back when pack v1 was current.
    const contentV1 = makeAsset({
      id: "content-v1",
      research_pack_id: "pack-v1",
      version: 1,
      structured_content: { source_references: ["v1-source"] },
    });

    // Later: research is re-run, producing a NEW approved pack (v2). All
    // sources from both packs are now in play across the topic.
    const allSourcesAfterV2 = [packV1Source, packV2Source];
    const byPack = groupSourcesByPackId(allSourcesAfterV2);

    // Content v1 must resolve against pack v1 only, never pack v2 — this
    // is true regardless of which pack is the topic's current/latest one.
    const resolved = sourcesForAsset(contentV1, byPack);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe("v1-source");
    expect(resolved.some((s) => s.research_pack_id === "pack-v2")).toBe(false);
  });

  it("REGRESSION (multi-version): each version in a lineage keeps its own pack's sources, not the latest version's pack", () => {
    const packV1Source = makeSource({ id: "v1-source", research_pack_id: "pack-v1" });
    const packV2Source = makeSource({ id: "v2-source", research_pack_id: "pack-v2" });
    const byPack = groupSourcesByPackId([packV1Source, packV2Source]);

    const contentV1 = makeAsset({ id: "content-v1", research_pack_id: "pack-v1", version: 1 });
    // Regenerated after research pack v2 was approved — this version
    // legitimately cites the newer pack.
    const contentV2 = makeAsset({ id: "content-v2", research_pack_id: "pack-v2", version: 2 });

    const lineage = groupContentAssetsByLineage([contentV1, contentV2])[0];
    expect(lineage.latest.id).toBe("content-v2");

    // The latest version correctly resolves against the new pack...
    expect(sourcesForAsset(lineage.latest, byPack).map((s) => s.id)).toEqual(["v2-source"]);
    // ...but the older version in the same lineage's history must NOT
    // pick up the new pack's sources just because it's now "the latest pack".
    const olderVersion = lineage.history.find((a) => a.id === "content-v1")!;
    expect(sourcesForAsset(olderVersion, byPack).map((s) => s.id)).toEqual(["v1-source"]);
  });
});
