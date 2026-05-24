"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "總覽" },
  { href: "/holdings", label: "持倉" },
  { href: "/holdings/new", label: "新增" },
  { href: "/trends", label: "趨勢" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { updateAll, batchStatus, batchMessage } = usePortfolio();

  const isUpdating = batchStatus === "loading";

  return (
    <div className="min-h-screen bg-page text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-page/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-bold tracking-tight">
              資產<span className="text-accent">管理</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV.map(({ href, label }) => {
                const active =
                  href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`rounded-lg px-3 py-1.5 transition ${
                      active
                        ? "bg-accent-dim text-accent font-medium"
                        : "text-muted hover:bg-surface-raised hover:text-foreground"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateAll()}
              disabled={isUpdating}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-accent-muted disabled:opacity-60"
            >
              {isUpdating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  更新中…
                </>
              ) : (
                "更新全部資產"
              )}
            </button>
            <ThemeToggle />
          </div>
        </div>
        {batchMessage && batchStatus !== "idle" && batchStatus !== "loading" && (
          <p
            className={`mx-auto max-w-6xl px-4 pb-2 text-xs sm:px-6 ${
              batchStatus === "error"
                ? "text-rose-500"
                : batchStatus === "partial"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-accent"
            }`}
          >
            {batchMessage}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        資料僅儲存於本機瀏覽器 · 價格來源 TWSE / 集保中心
      </footer>
    </div>
  );
}
