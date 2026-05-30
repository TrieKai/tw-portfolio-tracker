"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { usePortfolio } from "@/providers/PortfolioProvider";

export function AuthMenu() {
  const { data: session, status } = useSession();
  const { syncStatus, syncMessage, storageMode } = usePortfolio();

  const loading = status === "loading";
  const signedIn = status === "authenticated" && !!session?.user;

  if (loading) {
    return (
      <span className="hidden h-9 w-20 animate-pulse rounded-lg bg-surface-raised sm:inline-block" />
    );
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={() => signIn("google")}
        className="touch-target rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs font-medium text-foreground transition hover:bg-surface sm:px-3 sm:text-sm"
        title="登入後可在不同裝置同步持倉"
      >
        <span className="hidden sm:inline">Google 登入</span>
        <span className="sm:hidden">登入</span>
      </button>
    );
  }

  const name = session.user?.name ?? session.user?.email ?? "已登入";
  const syncHint =
    syncStatus === "syncing"
      ? "同步中…"
      : syncStatus === "error" && syncMessage
        ? syncMessage
        : storageMode === "cloud"
          ? "已同步"
          : null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="hidden max-w-[8rem] flex-col items-end text-right sm:flex">
        <span className="truncate text-xs font-medium text-foreground" title={name}>
          {name}
        </span>
        {syncHint && (
          <span
            className={`truncate text-[10px] ${
              syncStatus === "error" ? "text-rose-500" : "text-muted"
            }`}
            title={syncHint}
          >
            {syncHint}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="touch-target rounded-lg border border-border px-2.5 py-2 text-xs text-muted transition hover:bg-surface-raised hover:text-foreground sm:px-3 sm:text-sm"
      >
        登出
      </button>
    </div>
  );
}
