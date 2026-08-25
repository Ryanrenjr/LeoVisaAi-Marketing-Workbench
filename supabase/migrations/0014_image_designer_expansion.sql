-- LeoVisaAi 营销工作台 — Image Designer Expansion
-- Live user instruction: 图片设计员不只是小红书——需要三种独立能力：
--   1. 小红书/视频封面（单张封面图）
--   2. 公众号封面（单张封面图）
--   3. 小红书图文（多张，一页一张，配合已有的 pages 文案）
-- content_images already links to the specific content_asset a picture
-- was made from (so which platform it's for is always derivable), but a
-- xiaohongshu post now needs TWO distinct kinds of image against the same
-- content_asset_id (one cover, several carousel pages) — image_kind is
-- the discriminator that makes those distinguishable, and page_index
-- orders a carousel's pages back into P1, P2, P3...
alter table public.content_images
  add column image_kind text not null default 'cover' check (image_kind in ('cover', 'carousel')),
  add column page_index integer;
