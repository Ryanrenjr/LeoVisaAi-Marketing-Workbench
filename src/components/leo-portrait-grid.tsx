import { getLeoPortraitSignedUrl } from "@/lib/leo-portraits";
import { deleteLeoPortrait } from "@/app/team/image-designer/actions";
import type { LeoPortraitRow } from "@/lib/types";

/**
 * Thumbnails for the ADMIN-uploaded real photos of Leo used by
 * CoverWithPortraitAction (see generateOpenAIImageEdit in
 * src/lib/ai/providers/openai-provider.ts) — mirrors ContentImageGrid's
 * signed-URL-per-request pattern, since the bucket is private.
 */
async function PortraitThumbnail({ portrait, canManage }: { portrait: LeoPortraitRow; canManage: boolean }) {
  const url = await getLeoPortraitSignedUrl(portrait.image_path);
  if (!url) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block h-28 w-28 overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={portrait.label ?? "李尔王特写"} className="h-full w-full object-cover" />
      </a>
      {portrait.label && <p className="max-w-28 truncate text-xs text-[var(--muted)]">{portrait.label}</p>}
      {canManage && (
        <form action={deleteLeoPortrait.bind(null, portrait.id, portrait.image_path)}>
          <button type="submit" className="text-xs text-[var(--muted)] hover:text-red-600">
            删除
          </button>
        </form>
      )}
    </div>
  );
}

export function LeoPortraitGrid({ portraits, canManage }: { portraits: LeoPortraitRow[]; canManage: boolean }) {
  if (portraits.length === 0) {
    return <p className="text-sm text-[var(--muted)]">还没有上传过照片。</p>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      {portraits.map((portrait) => (
        <PortraitThumbnail key={portrait.id} portrait={portrait} canManage={canManage} />
      ))}
    </div>
  );
}
