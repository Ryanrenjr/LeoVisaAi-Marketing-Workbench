-- LeoVisaAi 营销工作台 — Image Search (video-editor / wechat-editor)
-- Live, explicit user instruction: 视频号/公众号 need real reference
-- images (Google Custom Search image results), not AI-generated ones —
-- 小红书's AI-generated cover images (image-designer) are unchanged.
-- Reuses the existing content_images table/bucket (migration 0009) rather
-- than a new table: whether an image was generated or searched, the
-- front end always fetches it the same way (getContentImageSignedUrl),
-- so this just widens content_images with a discriminator + provenance.

alter table public.content_images
  add column source text not null default 'generated' check (source in ('generated', 'searched')),
  add column search_query text,
  -- Attribution/traceability only — the actual bytes are always
  -- downloaded and re-hosted in the content-images bucket, never linked
  -- to directly, so there's no risk of a third-party URL expiring or
  -- moving out from under a published post.
  add column external_source_url text;
