export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <div className="mt-0.5 text-sm whitespace-pre-wrap">{children}</div>
    </div>
  );
}
