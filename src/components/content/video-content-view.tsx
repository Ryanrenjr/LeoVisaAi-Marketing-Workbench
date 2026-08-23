import { sourcesForAsset } from "@/lib/content-versions";
import type { VideoChannelContent } from "@/lib/ai/content-schemas";
import type { ContentAsset, ContentImageRow, ResearchSource } from "@/lib/types";
import { Field } from "./field";
import { ContentSources } from "./content-sources";
import { ExpertReviewNotes } from "./expert-review-notes";
import { ContentImageGrid } from "./content-image-grid";

function VideoFields({ content, sources }: { content: VideoChannelContent; sources: ResearchSource[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="标题">{content.title}</Field>
      <Field label="封面字">{content.cover_text}</Field>
      <Field label="预计时长">{content.target_duration_seconds} 秒</Field>
      <Field label="Hook">{content.hook}</Field>
      <Field label="完整口播">{content.full_script}</Field>
      <Field label="证据画面建议">
        <ul className="list-disc pl-5">
          {content.evidence_visuals.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </Field>
      <Field label="CTA">{content.cta}</Field>
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      <Field label="需要你确认">
        <ExpertReviewNotes notes={content.expert_review_notes} />
      </Field>
    </div>
  );
}

export function VideoContentView({
  history,
  sourcesByPackId,
  images = [],
}: {
  history: ContentAsset[];
  sourcesByPackId: Map<string, ResearchSource[]>;
  images?: ContentImageRow[];
}) {
  const [latest, ...older] = history;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">当前版本 v{latest.version}</p>
      <VideoFields
        content={latest.structured_content as unknown as VideoChannelContent}
        sources={sourcesForAsset(latest, sourcesByPackId)}
      />
      <ContentImageGrid images={images} />
      {older.map((asset) => (
        <details key={asset.id} className="rounded-md border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            历史版本 v{asset.version} · {new Date(asset.created_at).toLocaleString("zh-CN")}
          </summary>
          <div className="mt-3">
            <VideoFields
              content={asset.structured_content as unknown as VideoChannelContent}
              sources={sourcesForAsset(asset, sourcesByPackId)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
