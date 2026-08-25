import Link from "next/link";
import type { CurrentUser } from "@/lib/types";
import { LogoutButton } from "./logout-button";

/**
 * One presentation for everyone — no more Boss Mode / Admin Mode toggle
 * (live user instruction: single-operator reality, switching between two
 * views was pointless complexity). ADMIN always sees the same pipeline
 * home page as EXPERT, plus "管理" in the nav — gated on the real role,
 * not a switchable, forgettable cookie.
 */
export function Nav({ user }: { user: CurrentUser | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--accent-foreground)]">
              L
            </span>
            LeoVisaAi 营销工作台
          </Link>
          {user?.role === "ADMIN" && (
            <Link
              href="/admin"
              className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              管理
            </Link>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span className="rounded-full border border-[var(--border)] px-3 py-1">
              {user.displayName} · {user.role === "ADMIN" ? "管理员" : "专员"}
            </span>
            <LogoutButton />
          </div>
        )}
      </div>
    </header>
  );
}
