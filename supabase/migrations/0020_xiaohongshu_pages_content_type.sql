-- LeoVisaAi 营销工作台 — 修复：content_assets 的 content_type 检查约束里
-- 一直没有加入 'xiaohongshu_pages'。这个 content_type 是这次会话拆分小红书
-- 图文规划员（K）时新增的（见 content-schemas.ts XiaohongshuPagesPlanSchema），
-- 但当时只更新了应用代码，没有同步更新数据库约束——导致 K 生成图文规划时，
-- AI 调用本身成功，但保存到 content_assets 时被这条约束静默拒绝，页面上
-- 什么反应都没有（真实 bug 排查：ai_usage_log 显示多次 success=true，但
-- content_assets 里对应 topic 完全没有 xiaohongshu_pages 行）。用跟
-- 0016/0018/0019 一致的动态 DO 块模式，不硬编码约束名。
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.content_assets'::regclass
    and contype = 'c'
    and conname = 'content_assets_content_type_check';
  if cname is not null then
    execute format('alter table public.content_assets drop constraint %I', cname);
  end if;
end $$;

alter table public.content_assets add constraint content_assets_content_type_check
  check (content_type in (
    'video_script', 'xiaohongshu_post', 'xiaohongshu_pages',
    'wechat_outline', 'wechat_full_article', 'wechat_article'
  ));
