import { describe, expect, it } from "vitest";
import { deriveTitleAndContent, mergeEditIntoStructuredContent } from "./content-mapping";

describe("deriveTitleAndContent", () => {
  it("uses title/full_script for VIDEO_CHANNEL", () => {
    const result = deriveTitleAndContent("VIDEO_CHANNEL", { title: "标题", full_script: "口播稿" });
    expect(result).toEqual({ title: "标题", content: "口播稿" });
  });

  it("uses the first title option and joins pages for XIAOHONGSHU", () => {
    const result = deriveTitleAndContent("XIAOHONGSHU", {
      title_options: ["选项一", "选项二"],
      pages: ["第一页", "第二页"],
    });
    expect(result).toEqual({ title: "选项一", content: "第一页\n\n第二页" });
  });

  it("falls back to cover_title when XIAOHONGSHU has no title_options", () => {
    const result = deriveTitleAndContent("XIAOHONGSHU", { title_options: [], cover_title: "封面标题", pages: [] });
    expect(result.title).toBe("封面标题");
  });

  it("uses the first title option and summary for a WeChat outline", () => {
    const result = deriveTitleAndContent("WECHAT_OFFICIAL_ACCOUNT", {
      title_options: ["候选一"],
      summary: "摘要内容",
    });
    expect(result).toEqual({ title: "候选一", content: "摘要内容" });
  });
});

describe("mergeEditIntoStructuredContent", () => {
  it("updates title and full_script for VIDEO_CHANNEL, preserving other fields", () => {
    const merged = mergeEditIntoStructuredContent(
      "VIDEO_CHANNEL",
      { title: "旧标题", full_script: "旧口播", cta: "保留不变", source_references: ["src-1"] },
      "新标题",
      "新口播",
    );
    expect(merged.title).toBe("新标题");
    expect(merged.full_script).toBe("新口播");
    expect(merged.cta).toBe("保留不变");
    expect(merged.source_references).toEqual(["src-1"]);
  });

  it("re-splits the edited body into pages for XIAOHONGSHU and updates cover_title/title_options[0]", () => {
    const merged = mergeEditIntoStructuredContent(
      "XIAOHONGSHU",
      { title_options: ["旧标题", "备用标题"], cover_title: "旧封面", pages: ["旧P1"] },
      "新标题",
      "新P1\n\n新P2\n\n新P3",
    );
    expect(merged.title_options).toEqual(["新标题", "备用标题"]);
    expect(merged.cover_title).toBe("新标题");
    expect(merged.pages).toEqual(["新P1", "新P2", "新P3"]);
  });

  it("drops empty page chunks after re-splitting XIAOHONGSHU content", () => {
    const merged = mergeEditIntoStructuredContent(
      "XIAOHONGSHU",
      { title_options: ["t"], pages: [] },
      "t",
      "P1\n\n\n\nP2",
    );
    expect(merged.pages).toEqual(["P1", "P2"]);
  });

  it("updates summary for a WeChat outline (no full_article field present)", () => {
    const merged = mergeEditIntoStructuredContent(
      "WECHAT_OFFICIAL_ACCOUNT",
      { title_options: ["旧标题"], summary: "旧摘要", key_claims: ["保留"] },
      "新标题",
      "新摘要",
    );
    expect(merged.title_options).toEqual(["新标题"]);
    expect(merged.summary).toBe("新摘要");
    expect(merged.key_claims).toEqual(["保留"]);
  });

  it("updates full_article (not summary) for a WeChat full article, distinguished by shape", () => {
    const merged = mergeEditIntoStructuredContent(
      "WECHAT_OFFICIAL_ACCOUNT",
      { title: "旧标题", full_article: "旧正文" },
      "新标题",
      "新正文",
    );
    expect(merged.title).toBe("新标题");
    expect(merged.full_article).toBe("新正文");
    expect(merged.summary).toBeUndefined();
  });
});
