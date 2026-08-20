import Link from "next/link";
import type { CurrentUser } from "@/lib/types";
import type { ViewMode } from "@/lib/view-mode";
import { LogoutButton } from "./logout-button";
import { ModeSwitch } from "./mode-switch";

/**
 * Admin Mode's home page now shows the same employee cards as Boss Mode
 * (plus a collapsed "运营列表" section for the pipeline-stage pages no
 * employee owns — see src/app/page.tsx), so the nav no longer needs a
 * permanent 8-item link list. "管理" is the only thing genuinely not
 * reachable by clicking an employee card.
 */
export function Nav({ user, mode }: { user: CurrentUser | null; mode: ViewMode }) {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="font-semibold">
            LeoVisaAi 营销工作台
          </Link>
          {user?.role === "ADMIN" && mode === "admin" && (
            <Link href="/admin" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
              管理
            </Link>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            {user.role === "ADMIN" && <ModeSwitch mode={mode} />}
            <span>
              {user.displayName} · {user.role === "ADMIN" ? "管理员" : "专员"}
            </span>
            <LogoutButton />
          </div>
        )}
      </div>
    </header>
  );
}
