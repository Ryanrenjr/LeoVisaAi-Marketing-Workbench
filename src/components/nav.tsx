import Link from "next/link";
import type { CurrentUser } from "@/lib/types";
import type { ViewMode } from "@/lib/view-mode";
import { LogoutButton } from "./logout-button";
import { ModeSwitch } from "./mode-switch";

const ADMIN_LINKS = [
  { href: "/", label: "总览" },
  { href: "/topics", label: "选题库" },
  { href: "/team/researcher", label: "研究中心" },
  { href: "/ready-to-shoot", label: "可进入拍摄" },
  { href: "/published", label: "本周已发布" },
  { href: "/team/editor", label: "内容工作台" },
  { href: "/content-assets", label: "内容资产库" },
];

export function Nav({ user, mode }: { user: CurrentUser | null; mode: ViewMode }) {
  const isAdminNav = mode === "admin";

  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="font-semibold">
            LeoVisaAi 营销工作台
          </Link>
          {isAdminNav && (
            <nav className="flex flex-wrap gap-3 text-sm text-[var(--muted)]">
              {ADMIN_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-[var(--foreground)]">
                  {link.label}
                </Link>
              ))}
              {user?.role === "ADMIN" && (
                <Link href="/admin" className="hover:text-[var(--foreground)]">
                  管理
                </Link>
              )}
            </nav>
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
