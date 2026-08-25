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
