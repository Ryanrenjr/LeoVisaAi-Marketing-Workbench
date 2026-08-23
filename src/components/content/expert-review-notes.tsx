import type { EvidenceNote } from "@/lib/ai/content-schemas";

const REASON_LABEL: Record<EvidenceNote["reason"], string> = {
  expert_review_required: "需人工确认",
  research_gap: "研究未覆盖",
};

/** "需要你确认" — every platform's evidence-boundary flags, in one place. */
export function ExpertReviewNotes({ notes }: { notes: EvidenceNote[] }) {
  if (notes.length === 0) {
    return <p className="text-sm text-[var(--muted)]">无需额外确认的事项。</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {notes.map((note, i) => (
        <li
          key={i}
          className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
        >
          <span className="mr-2 inline-flex items-center rounded-full border border-amber-600/40 px-2 py-0.5 text-xs">
            {REASON_LABEL[note.reason]}
          </span>
          <strong>{note.claim}</strong>
          <p className="mt-1">{note.note}</p>
        </li>
      ))}
    </ul>
  );
}
