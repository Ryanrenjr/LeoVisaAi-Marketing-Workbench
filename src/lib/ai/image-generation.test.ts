import { describe, expect, it } from "vitest";
import { buildCoverImagePrompt, buildCarouselImagePrompt } from "./image-generation";
import { IMAGE_DESIGNER_VISUAL_RULES } from "./skills";

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

  it("does not tell the model to fuse in an attached reference photo by default (there isn't one)", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号");
    expect(prompt).not.toContain("参考图是李尔王本人的真实照片");
  });

  it("when includePortrait is true, tells the model to fuse the attached reference photo in, preserving his real likeness", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号", true);
    expect(prompt).toContain("参考图是李尔王本人的真实照片");
    expect(prompt).toContain("保留他的真实长相");
  });

  /**
   * Live incident (2026-09-16): 公众号封面 always calls this with
   * includePortrait:false (no reference photo ever attached), but the
   * model sometimes drew an invented face anyway — nothing in the prompt
   * actually forbade it, IMAGE_DESIGNER_VISUAL_RULES's old blanket "if you
   * draw him, use the real photo" line only mattered when a photo was
   * actually there to use.
   */
  it("when includePortrait is false, explicitly forbids a real-looking face instead of just saying nothing", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "公众号", false);
    expect(prompt).toContain("不能画出他的写实肖像");
    expect(prompt).not.toContain("参考图是李尔王本人的真实照片");
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

  /**
   * Live incident (2026-09-16): a 小红书 carousel page came back with an
   * invented face — this function has never had reference-image support
   * (no includePortrait param at all), so every page must explicitly
   * forbid a real-looking face, not just rely on the model refraining.
   */
  it("explicitly forbids a real-looking face — this function never attaches a reference photo", () => {
    const prompt = buildCarouselImagePrompt(TOPIC, { title: "t" }, { text: "x", pageNumber: 3, totalPages: 6 });
    expect(prompt).toContain("不能画出他的写实肖像");
  });
});

/**
 * Skills round: E｜图片设计员's formal Skill used to be completely
 * disconnected from the real image-generation prompt — router.ts's
 * runImageGenerationTask takes a plain string, never routed through
 * buildSkillPrompt, and image-generation.ts hand-rolled its own separate
 * STYLE_RULES text that had already drifted from the real Skill (still
 * describing a shared 小红书/视频号 cover well after the product removed
 * it). These tests prove the built prompts now actually derive from the
 * canonical skills.ts export, not an independently-maintained copy.
 */
describe("buildCoverImagePrompt / buildCarouselImagePrompt — genuinely wired to IMAGE_DESIGNER_VISUAL_RULES", () => {
  it("buildCoverImagePrompt includes a distinctive IMAGE_DESIGNER_VISUAL_RULES phrase", () => {
    const prompt = buildCoverImagePrompt(TOPIC, { title: "t", text: "x" }, "视频号");
    expect(prompt).toContain("不得新增任何未经 Research Pack 支持的法律事实或政策结论");
  });

  it("buildCarouselImagePrompt includes the same canonical rules text", () => {
    const prompt = buildCarouselImagePrompt(TOPIC, { title: "t" }, { text: "x", pageNumber: 1, totalPages: 3 });
    expect(prompt).toContain("不得新增任何未经 Research Pack 支持的法律事实或政策结论");
  });
});

/** Skills round: P1 is the 小红书 首图 — no separate cover exists or should ever be generated for it. */
describe("IMAGE_DESIGNER_VISUAL_RULES — explicit about 小红书's P1 being the 首图, no extra cover", () => {
  it("states P1 is the 首图 and no additional 小红书封面 is generated", () => {
    expect(IMAGE_DESIGNER_VISUAL_RULES).toContain("P1 本身就是首图/封面");
    expect(IMAGE_DESIGNER_VISUAL_RULES).toContain("不生成任何额外的独立小红书封面");
  });
});
