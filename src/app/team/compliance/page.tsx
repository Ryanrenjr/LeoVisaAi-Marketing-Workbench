import { getEmployee } from "@/lib/boss-language";

/**
 * Compliance is not implemented yet — this is a truthful placeholder,
 * never fabricated findings or counts. See CLAUDE.md.
 */
export default function CompliancePage() {
  const employee = getEmployee("compliance");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold">
          {employee.letter}
        </span>
        <h1 className="text-lg font-semibold">{employee.name}</h1>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-xs text-[var(--muted)]">我负责</p>
          <p className="mt-0.5 text-sm">检查内容有没有法律、证据、营销或表达风险。</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)]">状态</p>
          <p className="mt-0.5 text-sm">尚未启用</p>
        </div>
        <p className="text-sm text-[var(--muted)]">下一阶段上线</p>
      </div>
    </div>
  );
}
