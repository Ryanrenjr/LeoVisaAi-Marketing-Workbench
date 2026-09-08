import { Children } from "react";
import Image from "next/image";
import Link from "next/link";

/**
 * The home page as an assembly line, not a grid — arranged in real
 * working order with connecting rail lines and numbered steps. Live user
 * instruction: "把数字员工放人型...大一点，每一个页面都要尽可能的简洁" — big
 * real portraits carry the whole rail (no cluttered stat text — that
 * detail lives one click away on the employee's own page). Live user
 * instruction (follow-up, then reverted): a non-circular `object-contain`
 * frame was tried for future full-body art, but with the current square
 * photo-in-a-ring artwork it just showed a harsh white box in dark mode —
 * reverted back to a circular crop (bigger than the original size),
 * PersonNode/LaneCard/EmployeeHeader all use `rounded-full object-cover`.
 * Revisit non-circular framing only once real full-body cutout art
 * (transparent background, no ring baked in) actually exists. Live user
 * instruction (hand-drawn sketch): the parallel platform-editor step
 * (LaneGroup/BranchBar) reads as a real flowchart fork → cards → merge,
 * not a plain stacked list — see LaneGroup below. The "AI 一键产出" chip
 * was dropped by live user instruction ("没有用" — it repeated on every
 * row and added nothing) — only genuine exceptions still get a chip:
 * "⏸ 需要你看一眼" on the two real, code-enforced human gates, and
 * "你先上传数据" on the one step that needs your input first.
 */

export type StageKind = "auto" | "gate" | "input" | "conditional";

const CHIP_LABEL: Partial<Record<StageKind, string>> = {
  gate: "⏸ 需要你看一眼",
  input: "你先上传数据",
};

const CHIP_CLASS: Partial<Record<StageKind, string>> = {
  gate: "bg-[var(--muted)]/10 text-[var(--foreground)]",
  input: "bg-[var(--muted)]/10 text-[var(--foreground)]",
  conditional: "bg-[var(--muted)]/10 text-[var(--muted)]",
};

/**
 * A step whose real chip text varies per occurrence (round 8 home page
 * fix: "终审修改"/"最终复审"/"小红书图文规划" are each conditional for a
 * different reason — flagged content, a revised draft, or platform choice
 * — so a single fixed CHIP_LABEL string per StageKind doesn't fit; the
 * caller passes its own text via `conditionalText` instead.
 */
function StageChip({ kind, conditionalText }: { kind: StageKind; conditionalText?: string }) {
  const label = kind === "conditional" ? conditionalText : CHIP_LABEL[kind];
  if (!label) return null;
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP_CLASS[kind]}`}>{label}</span>
  );
}

/** The connecting rail line between one stage's portrait and the next — an explicit width/self-stretch, never `flex-1` inside a row container (that silently expands to a solid block, not a line). */
function RailThread() {
  return <div className="mx-auto w-0.5 flex-1 self-stretch bg-[var(--border)]" style={{ minHeight: 22 }} />;
}

const RAIL_WIDTH = 96;

/** The rail node IS the employee's own circular portrait — big enough to read as an actual person — with a numbered badge in the corner. Hover feedback (scale + brighter ring) is driven by the parent `.group` (the whole row/card is one hover target, not just the avatar itself). */
function PersonNode({ avatarId, step, size = RAIL_WIDTH }: { avatarId: string; step: number; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src={`/employees/${avatarId}.png`}
        alt=""
        fill
        className="rounded-full object-cover shadow-[0_0_0_1.5px_var(--border)] transition-transform duration-200 group-hover:scale-105"
      />
      <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)] ring-2 ring-[var(--background)] transition-shadow duration-200 group-hover:ring-[var(--accent)]/50">
        {step}
      </span>
    </div>
  );
}

export function StageRow({
  avatarId,
  step,
  name,
  actionLabel,
  href,
  kind,
  conditionalText,
  last = false,
}: {
  avatarId: string;
  step: number;
  name: string;
  actionLabel: string;
  href: string;
  kind: StageKind;
  /** Required when `kind === "conditional"` — see StageChip's doc comment. */
  conditionalText?: string;
  last?: boolean;
}) {
  return (
    <div className="group flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: RAIL_WIDTH }}>
        <PersonNode avatarId={avatarId} step={step} />
        {!last && <RailThread />}
      </div>
      <Link
        href={href}
        className="card mb-5 flex flex-1 items-center gap-3 px-5 py-4 hover:border-[var(--accent)]/40"
        style={{ animationDelay: `${step * 60}ms` }}
      >
        <p className="min-w-0 flex-1 truncate text-lg font-semibold">{name}</p>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StageChip kind={kind} conditionalText={conditionalText} />
          <span className="text-sm font-semibold text-[var(--accent)]">{actionLabel} →</span>
        </div>
      </Link>
    </div>
  );
}

/**
 * A fork/merge connector bar — a horizontal line spanning between the
 * center of the first and last branch, with one vertical tick per branch
 * dropping to (fork) or rising from (merge) that branch's card. Live user
 * instruction (hand-drawn sketch): the parallel platform-editor step
 * should read as a real flowchart branch, not a plain stacked list.
 */
function BranchBar({ count, edge }: { count: number; edge: "top" | "bottom" }) {
  return (
    <div className="relative h-6">
      <div
        className="absolute h-0.5 bg-[var(--accent)]/35"
        style={{ left: `${50 / count}%`, right: `${50 / count}%`, [edge]: 0 }}
      />
      <div className="absolute inset-0 flex">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-1 items-stretch justify-center">
            <div className="w-0.5 bg-[var(--accent)]/35" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A lane group — several stages that all run in parallel off the same
 * upstream step, drawn as an actual fork (single line in) → N cards side
 * by side → merge (single line out), not a stacked list. No left rail
 * column here (live user instruction: "左边的空不要了" — reserving the same
 * RAIL_WIDTH indent as the single-employee rows left a tall, visually
 * empty strip next to the branch diagram, since there's no single avatar
 * to put there for four parallel employees) — this section runs full
 * width instead, with the step number inline next to the label.
 */
export function LaneGroup({ step, label, children }: { step: number; label: string; children: React.ReactNode }) {
  const count = Children.count(children);
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)]">
          {step}
        </div>
        <p className="text-sm text-[var(--muted)]">{label}</p>
      </div>
      <BranchBar count={count} edge="top" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
      <BranchBar count={count} edge="bottom" />
    </div>
  );
}

export function LaneCard({
  avatarId,
  name,
  href,
}: {
  avatarId: string;
  name: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="card group flex flex-col items-center gap-2 px-3 py-4 text-center hover:border-[var(--accent)]/40"
    >
      <div className="relative h-16 w-16 shrink-0">
        <Image
          src={`/employees/${avatarId}.png`}
          alt=""
          fill
          className="rounded-full object-cover shadow-[0_0_0_1.5px_var(--border)] transition-transform duration-200 group-hover:scale-105"
        />
      </div>
      <p className="w-full truncate text-sm font-medium">{name}</p>
    </Link>
  );
}

export function GateNote({ text }: { text: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 justify-center" style={{ width: RAIL_WIDTH }} />
      <p className="mb-5 flex-1 rounded-[var(--radius-control)] bg-[var(--muted)]/8 px-4 py-2.5 text-sm text-[var(--foreground)]">
        ⏸ {text}
      </p>
    </div>
  );
}

export function ManualNote({ step, text }: { step?: number; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: RAIL_WIDTH }}>
        <div
          className="flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[var(--border)] text-3xl"
          style={{ width: RAIL_WIDTH, height: RAIL_WIDTH }}
        >
          🧍
        </div>
        <RailThread />
      </div>
      <div className="mb-5 flex flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--border)] bg-[var(--muted)]/5 px-5 py-4 text-sm text-[var(--muted)]">
        {step && <span className="shrink-0 text-xs font-bold">第{step}步</span>}
        {text}
      </div>
    </div>
  );
}

export function LoopBackNote({ text }: { text: string }) {
  return (
    <div className="card flex items-center gap-2.5 px-4 py-3 text-xs text-[var(--muted)]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0 text-[var(--accent)]">
        <path d="M9 10l-5 5 5 5" />
        <path d="M4 15h11a5 5 0 0 0 5-5V4" />
      </svg>
      {text}
    </div>
  );
}
