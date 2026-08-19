import type { ResearchSource } from "@/lib/types";

/** Resolves stored source_references (research_source UUIDs) back to their real source rows. */
export function ContentSources({
  sourceIds,
  sources,
}: {
  sourceIds: string[];
  sources: ResearchSource[];
}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const resolved = sourceIds.map((id) => byId.get(id)).filter((s): s is ResearchSource => Boolean(s));

  if (resolved.length === 0) {
    return <p className="text-sm text-[var(--muted)]">未引用具体来源。</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {resolved.map((source) => (
        <li key={source.id} className="text-sm">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-[var(--accent)] hover:underline"
          >
            {source.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
