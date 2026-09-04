import { describe, expect, it } from "vitest";
import { buildWechatBrandFooter, deriveTitleAndContent, mergeEditIntoStructuredContent } from "./content-mapping";

describe("deriveTitleAndContent", () => {
  it("uses title/full_script for VIDEO_CHANNEL", () => {
    const result = deriveTitleAndContent("VIDEO_CHANNEL", { title: "标题", full_script: "口播稿" });
    expect(result).toEqual({ title: "标题", content: "口播稿" });
  });

  it("uses the first title option and the caption for a XIAOHONGSHU title/caption asset (xiaohongshu_post)", () => {
    const result = deriveTitleAndContent("XIAOHONGSHU", {
      title_options: ["选项一", "选项二"],
      cover_title: "封面标题",
      caption: "发布文案",
    });
    expect(result).toEqual({ title: "选项一", content: "发布文案" });
  });

  it("falls back to cover_title when XIAOHONGSHU has no title_options", () => {
    const result = deriveTitleAndContent("XIAOHONGSHU", { title_options: [], cover_title: "封面标题", caption: "" });
    expect(result.title).toBe("封面标题");
  });

  it("joins pages for a XIAOHONGSHU image-text plan (xiaohongshu_pages), distinguished by shape", () => {
    const result = deriveTitleAndContent("XIAOHONGSHU", { pages: ["第一页", "第二页"] });
    expect(result).toEqual({ title: "图文规划（共 2 页）", content: "第一页\n\n第二页" });
  });

  it("uses title/full_article for a legacy WeChat full-article asset (no closing_note field)", () => {
    const result = deriveTitleAndContent("WECHAT_OFFICIAL_ACCOUNT", {
      title: "标题",
      full_article: "正文内容",
    });
    expect(result).toEqual({ title: "标题", content: "正文内容" });
  });

  it("joins full_article + closing_note + brand_footer for a current-shape WeChat article", () => {
    const result = deriveTitleAndContent("WECHAT_OFFICIAL_ACCOUNT", {
      title: "标题",
      full_article: "正文内容",
      closing_note: "结尾话术",
      brand_footer: "最后核验：2026-09-03\n\n本文由 Leo Visa Service 整理。",
    });
    expect(result).toEqual({
      title: "标题",
      content: "正文内容\n\n结尾话术\n\n最后核验：2026-09-03\n\n本文由 Leo Visa Service 整理。",
    });
  });

  it("still works for a current-shape WeChat article missing brand_footer (not yet injected)", () => {
    const result = deriveTitleAndContent("WECHAT_OFFICIAL_ACCOUNT", {
      title: "标题",
      full_article: "正文内容",
      closing_note: "结尾话术",
    });
    expect(result).toEqual({ title: "标题", content: "正文内容\n\n结尾话术" });
  });
});

describe("buildWechatBrandFooter", () => {
  it("prefixes the configured wechatFooter with today's 最后核验 date", () => {
    const footer = buildWechatBrandFooter({ wechatFooter: "本文由 Leo Visa Service 整理。" });
    expect(footer).toMatch(/^最后核验：\d{4}-\d{2}-\d{2}\n\n本文由 Leo Visa Service 整理。$/);
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

  it("updates title_options[0]/cover_title/caption for a XIAOHONGSHU title/caption asset (xiaohongshu_post)", () => {
    const merged = mergeEditIntoStructuredContent(
      "XIAOHONGSHU",
      { title_options: ["旧标题", "备用标题"], cover_title: "旧封面", caption: "旧文案" },
      "新标题",
      "新文案",
    );
    expect(merged.title_options).toEqual(["新标题", "备用标题"]);
    expect(merged.cover_title).toBe("新标题");
    expect(merged.caption).toBe("新文案");
  });

  it("re-splits the edited body into pages for a XIAOHONGSHU image-text plan, distinguished by shape", () => {
    const merged = mergeEditIntoStructuredContent("XIAOHONGSHU", { pages: ["旧P1"] }, "ignored", "新P1\n\n新P2\n\n新P3");
    expect(merged.pages).toEqual(["新P1", "新P2", "新P3"]);
  });

  it("drops empty page chunks after re-splitting a XIAOHONGSHU image-text plan", () => {
    const merged = mergeEditIntoStructuredContent("XIAOHONGSHU", { pages: [] }, "ignored", "P1\n\n\n\nP2");
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
