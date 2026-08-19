import Link from "next/link";
import type { CurrentUser } from "@/lib/types";
import { LogoutButton } from "./logout-button";

const LINKS = [
  { href: "/", label: "总览" },
  { href: "/topics", label: "选题库" },
  { href: "/research-completed", label: "研究已完成" },
  { href: "/ready-to-shoot", label: "可进入拍摄" },
  { href: "/published", label: "本周已发布" },
];

export function Nav({ user }: { user: CurrentUser | null }) {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold">LeoVisaAi 营销工作台</span>
          <nav className="flex flex-wrap gap-3 text-sm text-[var(--muted)]">
            {LINKS.map((link) => (
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
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
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
