import { sourcesForAsset } from "@/lib/content-versions";
import type { XiaohongshuContent, XiaohongshuPagesPlan } from "@/lib/ai/content-schemas";
import type { ContentAsset, ContentImageRow, ResearchSource } from "@/lib/types";
import type { BrandConfig } from "@/lib/brand-defaults";
import { validateXiaohongshuPost, validateXiaohongshuPagesPlan } from "@/lib/brand-validation";
import { Field } from "./field";
import { ContentSources } from "./content-sources";
import { ExpertReviewNotes } from "./expert-review-notes";
import { ContentImageGrid } from "./content-image-grid";
import { BrandCheckNotice } from "@/components/brand-check-notice";

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
      <Field label="正文">{content.caption}</Field>
      <Field label="关键词">{content.keywords.join(" · ")}</Field>
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      {content.expert_review_notes.length > 0 && (
        <Field label="需要你确认">
          <ExpertReviewNotes notes={content.expert_review_notes} />
        </Field>
      )}
    </div>
  );
}

export function XiaohongshuContentView({
  history,
  sourcesByPackId,
  images = [],
  brand,
}: {
  history: ContentAsset[];
  sourcesByPackId: Map<string, ResearchSource[]>;
  images?: ContentImageRow[];
  brand: BrandConfig;
}) {
  const [latest, ...older] = history;
  const latestContent = latest.structured_content as unknown as XiaohongshuContent;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">当前版本 v{latest.version}</p>
      <XiaohongshuFields content={latestContent} sources={sourcesForAsset(latest, sourcesByPackId)} />
      <BrandCheckNotice issues={validateXiaohongshuPost(latestContent, brand)} />
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

function XiaohongshuPagesFields({ content, sources }: { content: XiaohongshuPagesPlan; sources: ResearchSource[] }) {
  return (
    <div className="flex flex-col gap-4">
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
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      {content.expert_review_notes.length > 0 && (
        <Field label="需要你确认">
          <ExpertReviewNotes notes={content.expert_review_notes} />
        </Field>
      )}
    </div>
  );
}

/** The 图文规划 (per-page image-text plan) lineage — separate from XiaohongshuContentView's title/caption, written and illustrated by K｜小红书图文规划员. */
export function XiaohongshuPagesPlanView({
  history,
  sourcesByPackId,
  images = [],
  brand,
}: {
  history: ContentAsset[];
  sourcesByPackId: Map<string, ResearchSource[]>;
  images?: ContentImageRow[];
  brand: BrandConfig;
}) {
  const [latest, ...older] = history;
  const latestContent = latest.structured_content as unknown as XiaohongshuPagesPlan;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">图文规划 · 当前版本 v{latest.version}</p>
      <XiaohongshuPagesFields content={latestContent} sources={sourcesForAsset(latest, sourcesByPackId)} />
      <BrandCheckNotice issues={validateXiaohongshuPagesPlan(latestContent, brand)} />
      <ContentImageGrid images={images} />
      {older.map((asset) => (
        <details key={asset.id} className="rounded-md border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            历史版本 v{asset.version} · {new Date(asset.created_at).toLocaleString("zh-CN")}
          </summary>
          <div className="mt-3">
            <XiaohongshuPagesFields
              content={asset.structured_content as unknown as XiaohongshuPagesPlan}
              sources={sourcesForAsset(asset, sourcesByPackId)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
