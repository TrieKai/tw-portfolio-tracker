"use client";

import type { PortfolioStorage } from "@/lib/types/holding";

interface CloudMergeModalProps {
  localCount: number;
  cloudCount: number;
  onChooseLocal: () => void;
  onChooseCloud: () => void;
  onDismiss: () => void;
}

export function CloudMergeModal({
  localCount,
  cloudCount,
  onChooseLocal,
  onChooseCloud,
  onDismiss,
}: CloudMergeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-page p-5 shadow-xl">
        <h2 id="merge-title" className="text-lg font-semibold">
          選擇要使用的資料
        </h2>
        <p className="mt-2 text-sm text-muted">
          此裝置與雲端都有投資組合紀錄，請選擇要以哪一份為準。另一份不會自動刪除，但登入期間僅會同步您選擇的版本。
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            本機：<span className="font-medium text-foreground">{localCount}</span>{" "}
            筆持倉相關資料
          </li>
          <li>
            雲端：<span className="font-medium text-foreground">{cloudCount}</span>{" "}
            筆持倉相關資料
          </li>
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onChooseLocal}
            className="touch-target rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-muted"
          >
            使用本機並上傳雲端
          </button>
          <button
            type="button"
            onClick={onChooseCloud}
            className="touch-target rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            使用雲端資料
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="touch-target rounded-lg px-4 py-2.5 text-sm text-muted hover:text-foreground sm:mr-auto"
          >
            稍後再說
          </button>
        </div>
      </div>
    </div>
  );
}

/** 供合併提示用的持倉＋賣出筆數概覽 */
export function portfolioItemCount(state: PortfolioStorage): number {
  return state.holdings.length + state.sales.length;
}
