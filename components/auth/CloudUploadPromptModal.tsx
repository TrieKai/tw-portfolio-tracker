"use client";

import { describePortfolioStorage } from "@/lib/storage/portfolio-export";
import type { PortfolioStorage } from "@/lib/types/holding";

interface CloudUploadPromptModalProps {
  local: PortfolioStorage;
  onUpload: () => void;
  onKeepLocalOnly: () => void;
}

export function CloudUploadPromptModal({
  local,
  onUpload,
  onKeepLocalOnly,
}: CloudUploadPromptModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-prompt-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-page p-5 shadow-xl">
        <h2 id="upload-prompt-title" className="text-lg font-semibold">
          上傳本機資料到雲端？
        </h2>
        <p className="mt-2 text-sm text-muted">
          雲端目前沒有您的投資組合紀錄，但此裝置有{" "}
          {describePortfolioStorage(local)}。是否要上傳至雲端，供其他裝置登入同一
          Google 帳號時使用？
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onUpload}
            className="touch-target rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-muted"
          >
            上傳至雲端
          </button>
          <button
            type="button"
            onClick={onKeepLocalOnly}
            className="touch-target rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:bg-surface-raised"
          >
            暫不上傳
          </button>
        </div>
      </div>
    </div>
  );
}
