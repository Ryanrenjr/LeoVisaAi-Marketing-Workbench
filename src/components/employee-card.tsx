import Link from "next/link";

export interface EmployeeCardStat {
  label: string;
  value: number | string;
}

/**
 * Compact digital-employee card — letter marker, name, one-line
 * responsibility, up to a few status values, one primary action. No
 * illustrations, no colour beyond the existing accent. See
 * docs/digital-employee-ux.md.
 */
export function EmployeeCard({
  letter,
  name,
  status,
  responsibility,
  stats,
  actionLabel,
  href,
}: {
  letter: string;
  name: string;
  status: string;
  responsibility: string;
  stats: EmployeeCardStat[];
  actionLabel: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-md border border-[var(--border)] px-4 py-3 hover:border-[var(--accent)]"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
          {letter}
        </span>
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-xs text-[var(--muted)]">{status}</p>
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">{responsibility}</p>

      {stats.length > 0 && (
        <dl className="flex flex-col gap-0.5 text-sm">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">{s.label}</dt>
              <dd className="font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <span className="text-sm text-[var(--accent)]">{actionLabel} →</span>
    </Link>
  );
}
