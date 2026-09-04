/**
 * Pure brand-config type + defaults — no Supabase, no "server-only", so
 * it's directly unit-testable (mirrors employee-instruction-versions.ts's
 * split from employee-instructions.ts). The Supabase-backed
 * getBrandConfig() lives in brand-config.ts and falls back to
 * DEFAULT_BRAND_CONFIG for any key ADMIN hasn't overridden.
 */
export interface BrandConfig {
  companyNameEn: string;
  companyNameZh: string;
  contentBrand: string;
  expertName: string;
  videoOutro: string;
  wechatFooter: string;
  /**
   * A short, standalone credential fragment (e.g. "在英国生活22年，从事
   * 法律行业16年") — live user instruction: this specific claim IS real
   * and IS what actually gets published (confirmed by real published
   * examples shared live), so it belongs here as a verified, ADMIN-edited
   * value the AI is told to reuse verbatim — not banned outright the way
   * an unverified number would be. Used only in the WRITTEN 发布文案/
   * caption closing (small-red-book/video publish caption), never in the
   * spoken video script itself — the two have different closings, see
   * C｜视频号编辑员's Skill.
   */
  expertCredentials: string;
}

/**
 * Values from the live Skill spec (Section 10 "COMPANY BRAND CONFIGURATION")
 * — the same text already referenced inside EMPLOYEE_DEFAULT_SKILL's
 * WeChat/Xiaohongshu brand rules (see ai/skills.ts).
 */
export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  companyNameEn: "Leo Visa Service",
  companyNameZh: "李尔王国际移民",
  contentBrand: "李尔王移民说",
  expertName: "李尔王",
  videoOutro: "我是李尔王。这里是李尔王移民说。我会继续从真实规则和实际问题出发，把英国身份问题讲清楚。",
  wechatFooter:
    "本文由 Leo Visa Service（李尔王国际移民）根据公开政策及官方资料整理。李尔王移民说会继续从真实规则和实际问题出发，把英国身份问题讲清楚。本文为一般信息整理，不构成针对任何个人情况的具体移民法律意见。实际情况应结合最新规则及个人背景进一步判断。",
  expertCredentials: "在英国生活22年，从事法律行业16年",
};
