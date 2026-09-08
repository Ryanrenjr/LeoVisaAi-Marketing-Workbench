import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import type { ContentAsset } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));

const getTopicByIdMock = vi.fn();
const getContentAssetsMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getTopicById: (...args: unknown[]) => getTopicByIdMock(...args),
  getContentAssets: (...args: unknown[]) => getContentAssetsMock(...args),
}));

/** Chainable + thenable Supabase query-builder stub for `content_images` — one queued result per `.from("content_images")` call. */
let contentImagesResult: { data: unknown; error: unknown } = { data: [], error: null };
function chainable(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const storageDownloadMock = vi.fn();
function fakeBlob(): { arrayBuffer: () => Promise<ArrayBuffer>; type: string } {
  return { arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer, type: "image/png" };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => (table === "content_images" ? chainable(contentImagesResult) : chainable({ data: null, error: null })),
    storage: { from: () => ({ download: (...args: unknown[]) => storageDownloadMock(...args) }) },
  }),
}));

const { GET } = await import("./route");

function topic() {
  return { id: "topic-1", title: "测试选题" };
}

function videoAsset(overrides: Partial<Record<string, unknown>> = {}): ContentAsset {
  return {
    id: "video-1",
    platform: "VIDEO_CHANNEL",
    content_type: "video_script",
    version: 1,
    title: "视频标题",
    content: "unused",
    structured_content: {
      publish_title: "发布标题",
      publish_caption: "发布内容",
      full_script: "口播稿",
      ...overrides,
    },
  } as unknown as ContentAsset;
}

function xhsPostAsset(): ContentAsset {
  return {
    id: "xhs-post-1",
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_post",
    version: 1,
    title: "小红书标题",
    content: "小红书发布内容",
    structured_content: {},
  } as unknown as ContentAsset;
}

function xhsPagesAsset(declaredPages: number): ContentAsset {
  return {
    id: "xhs-pages-1",
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_pages",
    version: 1,
    title: "图文规划",
    content: "unused",
    structured_content: { pages: Array.from({ length: declaredPages }, (_, i) => `第${i + 1}页`) },
  } as unknown as ContentAsset;
}

function carouselImages(pageIndexes: number[]) {
  return pageIndexes.map((page_index) => ({ image_path: `xhs/${page_index}.png`, image_kind: "carousel", page_index }));
}

function coverImage() {
  return [{ image_path: "cover/1.png", image_kind: "cover" }];
}

function request(platform: string) {
  return new Request(`http://localhost/api/integrator/download?topicId=topic-1&platform=${platform}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getTopicByIdMock.mockResolvedValue(topic());
  contentImagesResult = { data: [], error: null };
  storageDownloadMock.mockResolvedValue({ data: fakeBlob(), error: null });
});

describe("XIAOHONGSHU package — P1 IS the 首图, no separate cover required", () => {
  it("fails closed when P1 is missing from the carousel (declared count and actual count mismatch)", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset(), xhsPagesAsset(3)]);
    contentImagesResult = { data: carouselImages([2, 3]), error: null }; // P1 missing

    const res = await GET(request("XIAOHONGSHU"));

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/图文规划共 3 页，实际打包 2 页/);
  });

  it("fails closed when any later page (Pn) is missing from the carousel", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset(), xhsPagesAsset(3)]);
    contentImagesResult = { data: carouselImages([1, 2]), error: null }; // P3 missing

    const res = await GET(request("XIAOHONGSHU"));

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/图文规划共 3 页，实际打包 2 页/);
  });

  it("succeeds with P1..Pn present and does NOT require or fetch any cover image", async () => {
    getContentAssetsMock.mockResolvedValue([xhsPostAsset(), xhsPagesAsset(2)]);
    contentImagesResult = { data: carouselImages([1, 2]), error: null };

    const res = await GET(request("XIAOHONGSHU"));

    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const files = Object.keys(zip.files).filter((name) => !name.endsWith("/"));
    expect(files.sort()).toEqual(["图文/P1.png", "图文/P2.png", "发布文案.html"].sort());
    // one storage download per carousel page, never an extra one for a cover
    expect(storageDownloadMock).toHaveBeenCalledTimes(2);
  });
});

describe("VIDEO_CHANNEL package — 发布标题/发布内容/口播稿 + independent cover, all required", () => {
  it("fails closed when publish_title is missing", async () => {
    getContentAssetsMock.mockResolvedValue([videoAsset({ publish_title: "" })]);
    contentImagesResult = { data: coverImage(), error: null };

    const res = await GET(request("VIDEO_CHANNEL"));

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/发布标题缺失/);
  });

  it("fails closed when publish_caption is missing", async () => {
    getContentAssetsMock.mockResolvedValue([videoAsset({ publish_caption: "" })]);
    contentImagesResult = { data: coverImage(), error: null };

    const res = await GET(request("VIDEO_CHANNEL"));

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/发布内容缺失/);
  });

  it("fails closed when full_script is missing", async () => {
    getContentAssetsMock.mockResolvedValue([videoAsset({ full_script: "" })]);
    contentImagesResult = { data: coverImage(), error: null };

    const res = await GET(request("VIDEO_CHANNEL"));

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/口播稿缺失/);
  });

  it("fails closed when the cover image is missing, even though all text fields are present", async () => {
    getContentAssetsMock.mockResolvedValue([videoAsset()]);
    contentImagesResult = { data: [], error: null }; // no cover row

    const res = await GET(request("VIDEO_CHANNEL"));

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/封面缺失/);
  });

  it("succeeds and produces 视频号内容.html + 视频封面 when every field and the cover are present", async () => {
    getContentAssetsMock.mockResolvedValue([videoAsset()]);
    contentImagesResult = { data: coverImage(), error: null };

    const res = await GET(request("VIDEO_CHANNEL"));

    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["视频号内容.html", "视频封面.png"].sort());
    const html = await zip.files["视频号内容.html"].async("string");
    expect(html).toContain("发布标题");
    expect(html).toContain("发布内容");
    expect(html).toContain("口播稿");
  });
});
