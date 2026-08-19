import { setViewMode } from "@/app/view-mode-actions";
import type { ViewMode } from "@/lib/view-mode";

/** ADMIN-only. EXPERT never sees this — resolveViewMode() ignores the cookie for EXPERT anyway. */
export function ModeSwitch({ mode }: { mode: ViewMode }) {
  const target: ViewMode = mode === "admin" ? "boss" : "admin";
  const label = target === "boss" ? "预览老板模式" : "返回管理员模式";

  return (
    <form action={setViewMode.bind(null, target, "/")}>
      <button
        type="submit"
        className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
      >
        {label}
      </button>
    </form>
  );
}
