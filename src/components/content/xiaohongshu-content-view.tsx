import { sourcesForAsset } from "@/lib/content-versions";
import type { XiaohongshuContent } from "@/lib/ai/content-schemas";
import type { ContentAsset, ContentImageRow, ResearchSource } from "@/lib/types";
import { Field } from "./field";
import { ContentSources } from "./content-sources";
import { ExpertReviewNotes } from "./expert-review-notes";
import { ContentImageGrid } from "./content-image-grid";

function XiaohongshuFields({ content, sources }: { content: XiaohongshuContent; sources: ResearchSource[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="标题候选">
        <ul className="list-disc pl-5">
          {content.title_options.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Field>
      <Field label="封面">{content.cover_title}</Field>
      <Field label={`P1–P${content.pages.length}`}>
        <ol className="flex flex-col gap-2">
          {content.pages.map((page, i) => (
            <li key={i} className="rounded-md border border-[var(--border)] px-3 py-2">
              <span className="text-xs text-[var(--muted)]">P{i + 1}</span>
              <p>{page}</p>
            </li>
          ))}
        </ol>
      </Field>
      <Field label="正文">{content.caption}</Field>
      <Field label="关键词">{content.keywords.join(" · ")}</Field>
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      <Field label="需要你确认">
        <ExpertReviewNotes notes={content.expert_review_notes} />
      </Field>
    </div>
  );
}

export function XiaohongshuContentView({
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
      <XiaohongshuFields
        content={latest.structured_content as unknown as XiaohongshuContent}
        sources={sourcesForAsset(latest, sourcesByPackId)}
      />
      <ContentImageGrid images={images} />
      {older.map((asset) => (
        <details key={asset.id} className="rounded-md border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            历史版本 v{asset.version} · {new Date(asset.created_at).toLocaleString("zh-CN")}
          </summary>
          <div className="mt-3">
            <XiaohongshuFields
              content={asset.structured_content as unknown as XiaohongshuContent}
              sources={sourcesForAsset(asset, sourcesByPackId)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
