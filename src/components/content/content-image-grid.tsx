import { getContentImageSignedUrl } from "@/lib/content-images";
import type { ContentImageRow } from "@/lib/types";

/**
 * One image's thumbnail, as a download link — extracted from
 * src/app/team/image-designer/page.tsx so it's shared by every place an
 * image needs to render (image-designer's own list, and now the combined
 * text+image views for video/xiaohongshu/wechat). Works for both AI-
 * generated and searched images (`ContentImageRow.source`) — the signed-
 * URL fetch is identical either way, since searched images are always
 * downloaded and re-hosted, never linked to directly.
 */
async function ImageThumbnail({ image }: { image: ContentImageRow }) {
  const url = await getContentImageSignedUrl(image.image_path);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block h-24 w-24 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]"
    >
      {/* Supabase signed URLs are per-request and short-lived — next/image's
          remote-pattern allowlist doesn't fit that, so this is a plain img. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="配图" className="h-full w-full object-cover" />
    </a>
  );
}

export function ContentImageGrid({ images }: { images: ContentImageRow[] }) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image) => (
        <ImageThumbnail key={image.id} image={image} />
      ))}
    </div>
  );
}
