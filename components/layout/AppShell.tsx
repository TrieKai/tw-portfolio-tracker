"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { AuthMenu } from "./AuthMenu";
import { MobileBottomNav } from "./MobileBottomNav";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "總覽" },
  { href: "/holdings", label: "持倉" },
  { href: "/holdings/new", label: "新增" },
  { href: "/trends", label: "趨勢" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { updateAll, batchStatus, batchMessage, storageMode } = usePortfolio();

  const isUpdating = batchStatus === "loading";

  return (
    <div className="min-h-screen bg-page text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-page/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <Link
            href="/"
            className="shrink-0 text-base font-bold tracking-tight sm:text-lg"
          >
            資產<span className="text-accent">追蹤</span>
          </Link>

          {/* 桌面導覽 */}
          <nav className="hidden flex-1 justify-center gap-1 text-sm md:flex">
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
                      ? "bg-accent-dim font-medium text-accent"
                      : "text-muted hover:bg-surface-raised hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => updateAll()}
              disabled={isUpdating}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-accent-muted disabled:opacity-60 sm:gap-2 sm:px-3 sm:text-sm touch-target"
            >
              {isUpdating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span className="sr-only sm:not-sr-only sm:static">
                    更新中…
                  </span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">更新全部資產</span>
                  <span className="sm:hidden">更新</span>
                </>
              )}
            </button>
            <AuthMenu />
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

      <main className="main-with-bottom-nav mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="footer-with-bottom-nav mx-auto max-w-6xl px-4 pb-6 text-center text-xs text-muted sm:px-6 sm:pb-8">
        {storageMode === "cloud"
          ? "已登入 Google · 持倉同步至雲端 · 價格來源 TWSE / 集保中心"
          : "匿名模式 · 資料僅存於本機瀏覽器 · 價格來源 TWSE / 集保中心"}
      </footer>

      <MobileBottomNav />
    </div>
  );
}
