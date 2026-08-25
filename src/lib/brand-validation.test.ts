import { describe, expect, it } from "vitest";
import {
  validateVideoScript,
  validateXiaohongshuPost,
  validateXiaohongshuPagesPlan,
  validateWechatArticle,
} from "./brand-validation";
import { DEFAULT_BRAND_CONFIG } from "./brand-defaults";

describe("validateVideoScript — Video outro validation", () => {
  it("passes when the script includes the configured expert name", () => {
    const issues = validateVideoScript(
      { full_script: `……${DEFAULT_BRAND_CONFIG.expertName}会继续更新。` },
      DEFAULT_BRAND_CONFIG,
    );
    expect(issues).toEqual([]);
  });

  it("flags a missing outro", () => {
    const issues = validateVideoScript({ full_script: "这是一段没有品牌收尾的口播稿。" }, DEFAULT_BRAND_CONFIG);
    expect(issues.length).toBe(1);
  });
});

describe("validateXiaohongshuPost — Xiaohongshu caption brand validation", () => {
  it("passes when the caption includes the expert name or content brand", () => {
    const issues = validateXiaohongshuPost(
      { caption: `欢迎关注 ${DEFAULT_BRAND_CONFIG.contentBrand}` },
      DEFAULT_BRAND_CONFIG,
    );
    expect(issues).toEqual([]);
  });

  it("flags a caption with no brand identity", () => {
    const issues = validateXiaohongshuPost({ caption: "完全无关的文案" }, DEFAULT_BRAND_CONFIG);
    expect(issues.length).toBe(1);
  });
});

describe("validateXiaohongshuPagesPlan — Xiaohongshu final-page brand validation", () => {
  it("passes when the last page includes the expert name or content brand", () => {
    const issues = validateXiaohongshuPagesPlan(
      { pages: ["P1 封面", "P2 结论", `P3 ${DEFAULT_BRAND_CONFIG.contentBrand}`] },
      DEFAULT_BRAND_CONFIG,
    );
    expect(issues).toEqual([]);
  });

  it("flags a final page with no brand identity", () => {
    const issues = validateXiaohongshuPagesPlan(
      { pages: ["P1 封面", "P2 结论", "P3 完全无关的收尾"] },
      DEFAULT_BRAND_CONFIG,
    );
    expect(issues.length).toBe(1);
  });
});

describe("validateWechatArticle", () => {
  const validArticle = `${DEFAULT_BRAND_CONFIG.companyNameZh} 整理了本文。最后核验：2026-08-24。${DEFAULT_BRAND_CONFIG.wechatFooter}`;

  it("passes a fully-compliant article", () => {
    expect(validateWechatArticle({ full_article: validArticle }, DEFAULT_BRAND_CONFIG)).toEqual([]);
  });

  it("WeChat company-name validation — flags a missing company name", () => {
    const article = validArticle
      .replaceAll(DEFAULT_BRAND_CONFIG.companyNameZh, "某机构")
      .replaceAll(DEFAULT_BRAND_CONFIG.companyNameEn, "Some Agency");
    const issues = validateWechatArticle({ full_article: article }, DEFAULT_BRAND_CONFIG);
    expect(issues.some((i) => i.includes("公司名称"))).toBe(true);
  });

  it("WeChat last-verified validation — flags a missing verification date", () => {
    const article = validArticle.replace("最后核验：2026-08-24。", "");
    const issues = validateWechatArticle({ full_article: article }, DEFAULT_BRAND_CONFIG);
    expect(issues.some((i) => i.includes("最后核验"))).toBe(true);
  });

  it("WeChat footer validation — flags a missing footer", () => {
    const article = `${DEFAULT_BRAND_CONFIG.companyNameZh} 整理了本文。最后核验：2026-08-24。`;
    const issues = validateWechatArticle({ full_article: article }, DEFAULT_BRAND_CONFIG);
    expect(issues.some((i) => i.includes("Footer"))).toBe(true);
  });
});
