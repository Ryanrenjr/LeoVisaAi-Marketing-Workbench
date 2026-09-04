import { describe, expect, it } from "vitest";
import { buildCoverImagePrompt, buildCarouselImagePrompt } from "./image-generation";

const TOPIC = { title: "老永居离境超过2年", business: "永居" };

describe("buildCoverImagePrompt", () => {
  it("includes the platform label, title, and topic in the prompt", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "永居还在吗？", text: "正文摘要" }, "视频号");
    expect(prompt).toContain("视频号");
    expect(prompt).toContain("永居还在吗？");
    expect(prompt).toContain(TOPIC.title);
  });

  it("never omits the anti-fabrication rule regardless of platform", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "公众号");
    expect(prompt).toContain("不得伪造");
    expect(prompt).toContain("GOV.UK");
  });

  it("says nothing about a reference photo by default", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号");
    expect(prompt).not.toContain("真实照片");
  });

  it("when includePortrait is true, tells the model to fuse the attached reference photo in, preserving his real likeness", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号", true);
    expect(prompt).toContain("参考图是李尔王本人的真实照片");
    expect(prompt).toContain("保留他的真实长相");
  });

  it("does not instruct the model to draw any specific data rows when no highlights are given", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号");
    expect(prompt).not.toContain("严格使用下面提供的原文");
    expect(prompt).not.toContain("1. ");
  });

  it("includes the exact highlight strings verbatim when provided", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号", false, [
      "ILR/ILE：2年",
      "EUSS：5年",
    ]);
    expect(prompt).toContain("ILR/ILE：2年");
    expect(prompt).toContain("EUSS：5年");
    expect(prompt).toContain("严格使用下面提供的原文");
  });

  it("includes a brand badge instruction only when contentBrand is given", () => {
    const withBrand = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号", false, [], "李尔王移民说");
    expect(withBrand).toContain("李尔王移民说");
    const withoutBrand = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号");
    expect(withoutBrand).not.toContain("品牌标签");
  });

  it("defaults to portrait composition, and switches to landscape when requested", () => {
    const portrait = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "公众号");
    expect(portrait).toContain("竖版构图");
    const landscape = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "公众号", false, [], undefined, "landscape");
    expect(landscape).toContain("横版通栏构图");
  });
});

describe("buildCarouselImagePrompt", () => {
  it("includes the page number, total pages, and page text", () => {
    const prompt = buildCarouselImagePrompt(TOPIC, { title: "笔记标题" }, {
      text: "第二页的内容",
      pageNumber: 2,
      totalPages: 6,
    });
    expect(prompt).toContain("2/6");
    expect(prompt).toContain("第二页的内容");
    expect(prompt).toContain("笔记标题");
  });

  it("asks for visual consistency across pages", () => {
    const prompt = buildCarouselImagePrompt(TOPIC, { title: "t" }, { text: "x", pageNumber: 1, totalPages: 3 });
    expect(prompt).toContain("同一组图文");
  });

  it("never omits the anti-fabrication rule", () => {
    const prompt = buildCarouselImagePrompt(TOPIC, { title: "t" }, { text: "x", pageNumber: 1, totalPages: 1 });
    expect(prompt).toContain("不得伪造");
  });
});
