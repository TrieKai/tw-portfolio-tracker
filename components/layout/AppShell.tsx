"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortfolio } from "@/providers/PortfolioProvider";
import {
  UiPreferencesProvider,
  useUiPreferences,
} from "@/providers/UiPreferencesProvider";
import { AuthMenu } from "./AuthMenu";
import { MobileBottomNav } from "./MobileBottomNav";
import { ThemeToggle } from "./ThemeToggle";
import { isActiveRoute, NAVIGATION } from "./navigation";

const AiLayoutAssistantModal = dynamic(() =>
  import("@/components/appearance/AiLayoutAssistantModal").then(
    (module) => module.AiLayoutAssistantModal
  )
);

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <UiPreferencesProvider>
      <AppShellContent>{children}</AppShellContent>
    </UiPreferencesProvider>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, holdings, updateAll, batchStatus, batchMessage, storageMode } = usePortfolio();
  const { preferences } = useUiPreferences();
  const [aiLayoutOpen, setAiLayoutOpen] = useState(false);
  const settings = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const isUpdating = batchStatus === "loading";

  return (
    <div
      className="flex min-h-screen flex-col bg-page text-foreground"
      data-ui-palette={preferences.palette}
      data-ui-density={preferences.density}
      data-ui-card-style={preferences.cardStyle}
    >
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3">
        跳至主要內容
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-md text-base font-bold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-accent-dim text-accent" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 19v-4m7 4v-7m7 7V9M5 10l7-5 4 2 3-3" />
              </svg>
            </span>
            資產追蹤
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="主要導覽">
            {NAVIGATION.map(({ href, label }) => {
              const active = isActiveRoute(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? (pathname === href ? "page" : "location") : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-medium lg:px-4 ${
                    active ? "bg-accent-dim text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void updateAll()}
              disabled={!ready || holdings.length === 0 || isUpdating}
              aria-label={isUpdating ? "正在更新全部資產" : "更新全部資產"}
              className="btn-secondary px-2.5 sm:px-3"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 ${isUpdating ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10a8 8 0 0 0-14-4l-2 2m0-5v5h5m-5 6a8 8 0 0 0 14 4l2-2m0 5v-5h-5" />
              </svg>
              <span>{isUpdating ? "更新中…" : "更新"}<span className="hidden lg:inline">{!isUpdating && "全部資產"}</span></span>
            </button>
            <button
              ref={settingsButton}
              type="button"
              popoverTarget="app-settings"
              className="btn-secondary"
            >
              設定
            </button>
            <div ref={settings} id="app-settings" popover="auto" className="app-settings space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-4 text-foreground shadow-lg">
              <AuthMenu />
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
                <ThemeToggle />
                <button
                  type="button"
                  onClick={() => {
                    settings.current?.hidePopover();
                    settingsButton.current?.focus();
                    setAiLayoutOpen(true);
                  }}
                  className="btn-secondary"
                >
                  版面設定
                </button>
              </div>
            </div>
          </div>
        </div>
        <div role="status" className="mx-auto max-w-7xl px-4 text-sm sm:px-6">
          {isUpdating ? (
            <p className="sr-only">正在更新資產價格</p>
          ) : batchMessage && batchStatus !== "idle" ? (
            <p className={`pb-2 ${
              batchStatus === "error"
                ? "text-rose-700 dark:text-rose-300"
                : batchStatus === "partial"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-accent"
            }`}>
              {batchMessage}
            </p>
          ) : null}
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="app-main main-with-bottom-nav mx-auto w-full max-w-7xl flex-1 px-4 pt-6 sm:px-6 sm:pt-8">
        {children}
      </main>

      <footer className="footer-with-bottom-nav mx-auto flex w-full max-w-7xl flex-wrap justify-between gap-x-6 gap-y-2 px-4 text-xs text-muted sm:px-6">
        <span>{storageMode === "cloud" ? "Google 雲端同步" : "資料儲存於此瀏覽器"}</span>
        <span>價格來源 TWSE／集保中心</span>
      </footer>

      <MobileBottomNav />
      {aiLayoutOpen && <AiLayoutAssistantModal onClose={() => setAiLayoutOpen(false)} />}
    </div>
  );
}
