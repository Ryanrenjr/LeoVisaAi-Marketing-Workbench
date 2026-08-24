/**
 * Deterministic brand-check result (src/lib/brand-validation.ts) rendered
 * as a yellow notice — a reminder for the human reviewer, not a hard gate
 * (brand wording can legitimately have edge-case exceptions). Renders
 * nothing when `issues` is empty.
 */
export function BrandCheckNotice({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
      <p className="font-medium">品牌一致性提醒</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}
