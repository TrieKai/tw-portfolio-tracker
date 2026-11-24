"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { usePortfolio } from "@/providers/PortfolioProvider";

export function AuthMenu() {
  const { data: session, status } = useSession();
  const { syncStatus, syncMessage, storageMode, refreshFromCloud } = usePortfolio();

  if (status === "loading") {
    return <p role="status" className="text-sm text-muted">正在確認登入狀態…</p>;
  }

  if (status !== "authenticated" || !session?.user) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">登入 Google 後可跨裝置同步持倉。</p>
        <button type="button" onClick={() => void signIn("google")} className="btn-primary w-full">
          Google 登入
        </button>
      </div>
    );
  }

  const name = session.user.name ?? session.user.email ?? "已登入 Google";
  const syncHint = syncMessage ?? (syncStatus === "syncing"
    ? "同步中…"
    : storageMode === "cloud" ? "雲端同步已開啟" : "目前只存本機");

  return (
    <div className="space-y-3">
      <div className="break-words">
        <p className="text-sm font-semibold">{name}</p>
        <p role="status" className={`mt-1 text-sm ${syncStatus === "error" ? "text-rose-700 dark:text-rose-300" : "text-muted"}`}>
          {syncHint}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void refreshFromCloud()}
          disabled={syncStatus === "syncing"}
          className="btn-secondary"
        >
          {storageMode === "cloud" ? "查看雲端版本" : "啟用雲端同步"}
        </button>
        <button type="button" onClick={() => void signOut({ callbackUrl: "/" })} className="btn-secondary">
          登出
        </button>
      </div>
    </div>
  );
}
