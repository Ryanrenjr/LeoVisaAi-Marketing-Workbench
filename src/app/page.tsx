import Link from "next/link";
import { getStageCounts, isDemoMode } from "@/lib/topics";
import { PIPELINE_STAGES } from "@/lib/status";

export default async function DashboardPage() {
  const [counts, demo] = await Promise.all([getStageCounts(), isDemoMode()]);
  const libraryCount = counts.IDEA + counts.RESEARCHING + counts.RESEARCH_READY;

  return (
    <div className="flex flex-col gap-10">
      {demo && (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase）。配置 .env.local 后将显示真实数据。
        </p>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Link
          href="/topics"
          className="rounded-md border border-[var(--border)] px-4 py-3 hover:bg-[var(--border)]/20"
        >
          <p className="text-sm text-[var(--muted)]">选题库</p>
          <p className="mt-1 text-2xl font-semibold">{libraryCount}</p>
        </Link>
        {PIPELINE_STAGES.map((stage) => (
          <Link
            key={stage.status}
            href={stage.href}
            className="rounded-md border border-[var(--border)] px-4 py-3 hover:bg-[var(--border)]/20"
          >
            <p className="text-sm text-[var(--muted)]">{stage.label}</p>
            <p className="mt-1 text-2xl font-semibold">{counts[stage.status]}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
