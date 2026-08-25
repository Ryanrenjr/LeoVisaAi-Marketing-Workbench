-- LeoVisaAi 营销工作台 — WeChat: skip the outline, generate the article directly
-- Live user instruction: 不要大纲直接给文字 — 公众号不再要求先生成大纲、再单独点
-- "生成完整文章"两步，改成一步直接产出完整文章（含备选标题、摘要导语、正文、
-- 金句、首图文字建议、朋友圈转发文案等，见 content-schemas.ts
-- WechatArticleSchema）。wechat_outline / wechat_full_article 两个旧
-- content_type 保留，历史版本继续可读；新生成一律落在 wechat_article。
alter table public.content_assets drop constraint content_assets_content_type_check;
alter table public.content_assets add constraint content_assets_content_type_check
  check (content_type in ('video_script', 'xiaohongshu_post', 'wechat_outline', 'wechat_full_article', 'wechat_article'));
