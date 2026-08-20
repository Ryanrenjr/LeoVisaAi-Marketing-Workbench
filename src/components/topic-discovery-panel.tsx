"use client";

import { useState, useTransition } from "react";
import { addDiscoveredTopic, discoverTopics } from "@/app/team/planner/actions";
import { Button } from "./ui/button";
import type { TopicCandidate } from "@/lib/ai/topic-discovery";

/**
 * A triage list, not a form: 通过 (✓) adds the candidate and it's gone;
 * 淘汰 (✗) just drops it from view, no confirmation, nothing saved either
 * way for a ✗ — re-running the search costs nothing. Live user
 * instruction: "打对勾就是通过，叉就是淘汰直接消失，页面最简单简洁。"
 */
function CandidateRow({
  candidate,
  onDecide,
}: {
  candidate: TopicCandidate;
  onDecide: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <li className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{candidate.title}</p>
        <p className="mt-0.5 truncate text-sm text-[var(--muted)]">{candidate.reason}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          aria-label="淘汰"
          disabled={adding}
          onClick={onDecide}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-lg hover:bg-[var(--border)]/20 disabled:opacity-50"
        >
          ✗
        </button>
        <button
          type="button"
          aria-label="通过"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            const result = await addDiscoveredTopic(candidate);
            if (result.ok) onDecide();
            else setAdding(false);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--accent)] text-lg text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
        >
          ✓
        </button>
      </div>
    </li>
  );
}

export function TopicDiscoveryPanel() {
  const [candidates, setCandidates] = useState<TopicCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function dismiss(index: number) {
    setCandidates((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-[var(--muted)]">今日选题搜索</h2>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await discoverTopics();
              if (result.error) setError(result.error);
              setCandidates(result.candidates);
            });
          }}
        >
          {isPending ? "搜索中…" : "开始搜索选题"}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {candidates !== null && !error && candidates.length === 0 && (
        <p className="text-sm text-[var(--muted)]">今天没有找到值得做的新选题，稍后再试试。</p>
      )}

      {candidates !== null && candidates.length > 0 && (
        <ul>
          {candidates.map((c, i) => (
            <CandidateRow key={`${c.title}-${i}`} candidate={c} onDecide={() => dismiss(i)} />
          ))}
        </ul>
      )}
    </section>
  );
}
