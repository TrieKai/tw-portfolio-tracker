"use client";

import { Modal } from "@/components/ui/Modal";
import { describePortfolioStorage } from "@/lib/storage/portfolio-export";
import type { PortfolioStorage } from "@/lib/types/holding";

interface CloudMergeModalProps {
  local: PortfolioStorage;
  cloud: PortfolioStorage;
  onChooseLocal: () => void;
  onChooseCloud: () => void;
  onDismiss: () => void;
}

export function CloudMergeModal({
  local,
  cloud,
  onChooseLocal,
  onChooseCloud,
  onDismiss,
}: CloudMergeModalProps) {
  return (
    <Modal labelledBy="merge-title" onClose={onDismiss}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-page p-5 shadow-xl">
        <h2 id="merge-title" className="text-lg font-semibold">
          選擇要使用的資料
        </h2>
        <p className="mt-2 text-sm text-muted">
          本機與雲端的資料不同。請選擇一份作為同步版本，或先維持只存本機。取代前可在持倉頁匯出本機備份。
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            本機：<span className="font-medium text-foreground">{describePortfolioStorage(local)}</span>
          </li>
          <li>
            雲端：<span className="font-medium text-foreground">{describePortfolioStorage(cloud)}</span>
          </li>
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onChooseLocal}
            className="touch-target rounded-lg bg-accent-button px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            用本機資料取代雲端
          </button>
          <button
            type="button"
            onClick={onChooseCloud}
            className="touch-target rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            用雲端資料取代本機
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="touch-target rounded-lg px-4 py-2.5 text-sm text-muted hover:text-foreground sm:mr-auto"
          >
            繼續只存本機
          </button>
        </div>
      </div>
    </Modal>
  );
}
