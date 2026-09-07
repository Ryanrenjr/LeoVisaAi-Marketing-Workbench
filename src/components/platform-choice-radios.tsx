/**
 * "在一键出选题的时候，可以有一个选择" (live user instruction) — a plain
 * native radio group, no client JS needed. `name="platforms"` lands in the
 * FormData the bound Server Action receives — see approveAndGoHome in
 * pipeline-actions.ts. `has-[:checked]` (native CSS :has()) highlights the
 * selected pill without any state.
 */
const OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "一键全出" },
  { value: "XIAOHONGSHU", label: "小红书图文" },
  { value: "VIDEO_CHANNEL", label: "视频号口播" },
  { value: "WECHAT_OFFICIAL_ACCOUNT", label: "公众号文字" },
];

export function PlatformChoiceRadios() {
  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((opt, i) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent)]/10 has-[:checked]:text-[var(--foreground)]"
        >
          <input type="radio" name="platforms" value={opt.value} defaultChecked={i === 0} className="accent-[var(--accent)]" />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
