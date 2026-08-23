import Image from "next/image";
import Link from "next/link";

/**
 * The home page as an assembly line, not a grid — arranged in real
 * working order with connecting rail lines and numbered steps. Live user
 * instruction: "把数字员工放人型...大一点，每一个页面都要尽可能的简洁" — big,
 * circular real portraits carry the whole rail (no cluttered stat text —
 * that detail lives one click away on the employee's own page), and every
 * chip is a fixed, honest label: "AI 一键产出" only appears on steps that
 * really are one click, "⏸ 需要你看一眼" only on the two real,
 * code-enforced human gates (research approval, compliance review).
 */

export type StageKind = "auto" | "gate" | "input";

const CHIP_LABEL: Record<StageKind, string> = {
  auto: "AI 一键产出",
  gate: "⏸ 需要你看一眼",
  input: "你先上传数据",
};

const CHIP_CLASS: Record<StageKind, string> = {
  auto: "bg-[var(--accent)]/10 text-[var(--accent)]",
  gate: "bg-[var(--muted)]/10 text-[var(--foreground)]",
  input: "bg-[var(--muted)]/10 text-[var(--foreground)]",
};

function StageChip({ kind }: { kind: StageKind }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP_CLASS[kind]}`}>
      {CHIP_LABEL[kind]}
    </span>
  );
}

/** The connecting rail line between one stage's portrait and the next — an explicit width/self-stretch, never `flex-1` inside a row container (that silently expands to a solid block, not a line). */
function RailThread() {
  return <div className="mx-auto w-0.5 flex-1 self-stretch bg-[var(--border)]" style={{ minHeight: 22 }} />;
}

const RAIL_WIDTH = 72;

/** The rail node IS the employee's own portrait — big enough to read as an actual person — with a numbered badge in the corner. */
function PersonNode({ avatarId, step, size = RAIL_WIDTH }: { avatarId: string; step: number; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src={`/employees/${avatarId}.png`}
        alt=""
        width={size}
        height={size}
        className="h-full w-full rounded-full border-2 border-[var(--background)] object-cover shadow-[0_0_0_1.5px_var(--border)]"
      />
      <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)] ring-2 ring-[var(--background)]">
        {step}
      </span>
    </div>
  );
}

export function StageRow({
  avatarId,
  step,
  name,
  status,
  actionLabel,
  href,
  kind,
  last = false,
}: {
  avatarId: string;
  step: number;
  name: string;
  status: string;
  actionLabel: string;
  href: string;
  kind: StageKind;
  last?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: RAIL_WIDTH }}>
        <PersonNode avatarId={avatarId} step={step} />
        {!last && <RailThread />}
      </div>
      <Link
        href={href}
        className="card mb-5 flex flex-1 items-center gap-3 px-5 py-4 hover:border-[var(--accent)]/40"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{name}</p>
          <p className="truncate text-sm text-[var(--muted)]">{status}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StageChip kind={kind} />
          <span className="text-sm font-semibold text-[var(--accent)]">{actionLabel} →</span>
        </div>
      </Link>
    </div>
  );
}

/** A lane group — several stages that all run in parallel off the same upstream step (the three platform editors). */
export function LaneGroup({ step, label, children }: { step: number; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: RAIL_WIDTH }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-[var(--accent-foreground)]">
          {step}
        </div>
        <RailThread />
      </div>
      <div className="mb-2 flex flex-1 flex-col gap-2.5">
        <p className="text-sm text-[var(--muted)]">{label}</p>
        {children}
      </div>
    </div>
  );
}

export function LaneCard({
  avatarId,
  name,
  status,
  href,
}: {
  avatarId: string;
  name: string;
  status: string;
  href: string;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 px-4 py-3 hover:border-[var(--accent)]/40">
      <Image
        src={`/employees/${avatarId}.png`}
        alt=""
        width={48}
        height={48}
        className="h-12 w-12 shrink-0 rounded-full object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-[var(--muted)]">{status}</p>
      </div>
      <StageChip kind="auto" />
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
        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[var(--border)] text-2xl">
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
