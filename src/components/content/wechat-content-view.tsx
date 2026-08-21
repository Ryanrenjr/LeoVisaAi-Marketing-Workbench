import { sourcesForAsset } from "@/lib/content-versions";
import type { WechatFullArticle, WechatOutline } from "@/lib/ai/content-schemas";
import type { ContentAsset, ContentImageRow, ResearchSource } from "@/lib/types";
import { Field } from "./field";
import { ContentSources } from "./content-sources";
import { ExpertReviewNotes } from "./expert-review-notes";
import { ContentImageGrid } from "./content-image-grid";

function WechatOutlineFields({ content, sources }: { content: WechatOutline; sources: ResearchSource[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="标题候选">
        <ul className="list-disc pl-5">
          {content.title_options.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Field>
      <Field label="摘要">{content.summary}</Field>
      <Field label="文章结构">
        <ol className="list-decimal pl-5">
          {content.detailed_outline.map((section, i) => (
            <li key={i}>{section}</li>
          ))}
        </ol>
      </Field>
      <Field label="关键主张">
        <ul className="list-disc pl-5">
          {content.key_claims.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </Field>
      <Field label="FAQ">
        <dl className="flex flex-col gap-2">
          {content.faq.map((item, i) => (
            <div key={i}>
              <dt className="font-medium">{item.question}</dt>
              <dd className="text-[var(--muted)]">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </Field>
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      <Field label="需要Leo确认">
        <ExpertReviewNotes notes={content.expert_review_notes} />
      </Field>
    </div>
  );
}

function WechatFullArticleFields({
  content,
  sources,
}: {
  content: WechatFullArticle;
  sources: ResearchSource[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="标题">{content.title}</Field>
      <Field label="完整文章">{content.full_article}</Field>
      <Field label="来源">
        <ContentSources sourceIds={content.source_references} sources={sources} />
      </Field>
      <Field label="需要Leo确认">
        <ExpertReviewNotes notes={content.expert_review_notes} />
      </Field>
    </div>
  );
}

export function WechatOutlineView({
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
      <p className="text-xs text-[var(--muted)]">大纲 · 当前版本 v{latest.version}</p>
      <WechatOutlineFields
        content={latest.structured_content as unknown as WechatOutline}
        sources={sourcesForAsset(latest, sourcesByPackId)}
      />
      <ContentImageGrid images={images} />
      {older.map((asset) => (
        <details key={asset.id} className="rounded-md border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            历史版本 v{asset.version} · {new Date(asset.created_at).toLocaleString("zh-CN")}
          </summary>
          <div className="mt-3">
            <WechatOutlineFields
              content={asset.structured_content as unknown as WechatOutline}
              sources={sourcesForAsset(asset, sourcesByPackId)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

export function WechatFullArticleView({
  history,
  sourcesByPackId,
}: {
  history: ContentAsset[];
  sourcesByPackId: Map<string, ResearchSource[]>;
}) {
  const [latest, ...older] = history;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--muted)]">完整文章 · 当前版本 v{latest.version}</p>
      <WechatFullArticleFields
        content={latest.structured_content as unknown as WechatFullArticle}
        sources={sourcesForAsset(latest, sourcesByPackId)}
      />
      {older.map((asset) => (
        <details key={asset.id} className="rounded-md border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            历史版本 v{asset.version} · {new Date(asset.created_at).toLocaleString("zh-CN")}
          </summary>
          <div className="mt-3">
            <WechatFullArticleFields
              content={asset.structured_content as unknown as WechatFullArticle}
              sources={sourcesForAsset(asset, sourcesByPackId)}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
