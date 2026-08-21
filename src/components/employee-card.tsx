import Image from "next/image";
import Link from "next/link";

export interface EmployeeCardStat {
  label: string;
  value: number | string;
}

/**
 * Compact digital-employee card — avatar illustration, name, one-line
 * responsibility, up to a few status values, one primary action. Per-
 * employee avatar illustrations (public/employees/<id>.png) live by
 * explicit live user instruction, overriding this milestone's earlier
 * "no illustrations, no colour" note — see docs/digital-employee-ux.md.
 */
export function EmployeeCard({
  avatarId,
  letter,
  name,
  status,
  responsibility,
  stats,
  actionLabel,
  href,
}: {
  avatarId: string;
  letter: string;
  name: string;
  status: string;
  responsibility: string;
  stats: EmployeeCardStat[];
  actionLabel: string;
  href: string;
}) {
  return (
    <Link href={href} className="card flex flex-col gap-3 px-5 py-4 hover:border-[var(--accent)]/40">
      <div className="flex items-center gap-3">
        <Image
          src={`/employees/${avatarId}.png`}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0">
          <p className="font-semibold">
            <span className="mr-1.5 text-xs text-[var(--muted)]">{letter}</span>
            {name}
          </p>
          <p className="text-xs text-[var(--muted)]">{status}</p>
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">{responsibility}</p>

      {stats.length > 0 && (
        <dl className="flex flex-col gap-0.5 text-sm">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-[var(--muted)]">{s.label}</dt>
              <dd className="font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <span className="text-sm font-semibold text-[var(--accent)]">{actionLabel} →</span>
    </Link>
  );
}
