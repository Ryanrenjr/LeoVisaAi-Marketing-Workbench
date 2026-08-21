import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/nav";
import { getCurrentUser } from "@/lib/auth";
import { resolveViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "LeoVisaAi 营销工作台",
  description: "内部营销内容流程看板",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()]);
  const mode = resolveViewMode(user?.role ?? "EXPERT", cookieStore.get(VIEW_MODE_COOKIE)?.value);

  return (
    <html lang="zh-CN" className={`h-full antialiased ${inter.variable}`}>
      <body className="flex min-h-full flex-col">
        <Nav user={user} mode={mode} />
        <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</div>
      </body>
    </html>
  );
}
