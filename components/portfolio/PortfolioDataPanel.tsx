"use client";

import { Modal } from "@/components/ui/Modal";
import { useCallback, useRef, useState } from "react";
import {
  describePortfolioStorage,
  downloadPortfolioExport,
  readPortfolioImportFile,
  type PortfolioImportMode,
} from "@/lib/storage/portfolio-export";
import type { PortfolioStorage } from "@/lib/types/holding";
import { hasPortfolioData } from "@/lib/storage/parse-portfolio";
import { usePortfolio } from "@/providers/PortfolioProvider";

interface ImportConfirmState {
  portfolio: PortfolioStorage;
  summary: string;
  mode: PortfolioImportMode;
}

export function PortfolioDataPanel() {
  const { storage, storageMode, syncStatus, importPortfolio, refreshFromCloud } =
    usePortfolio();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<ImportConfirmState | null>(null);

  const handleExport = useCallback(() => {
    downloadPortfolioExport(storage);
    setMessage({ type: "ok", text: "已下載備份 JSON 檔" });
  }, [storage]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setMessage(null);
      const parsed = await readPortfolioImportFile(file);
      if (!parsed.ok) {
        setMessage({ type: "error", text: parsed.error });
        return;
      }

      if (!hasPortfolioData(parsed.portfolio)) {
        setMessage({ type: "error", text: "備份檔內沒有可匯入的持倉、貸款或交易紀錄" });
        return;
      }

      setConfirm({
        portfolio: parsed.portfolio,
        summary: describePortfolioStorage(parsed.portfolio),
        mode: "merge",
      });
    },
    []
  );

  const runImport = useCallback(async () => {
    if (!confirm || importing) return;
    setImporting(true);
    setMessage(null);
    const saved = await importPortfolio(confirm.portfolio, confirm.mode);
    setImporting(false);
    if (!saved) {
      setMessage({ type: "error", text: "未能儲存備份資料。若本機資料已損毀，可選擇取代全部。也請確認瀏覽器儲存空間。" });
      return;
    }
    setMessage({
      type: "ok",
      text: confirm.mode === "replace" ? "已用備份取代資料。" : "備份已合併。",
    });
    setConfirm(null);
  }, [confirm, importing, importPortfolio]);

  return (
    <>
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-lg font-semibold">資料備份</h2>
        <p className="mt-1 text-sm text-muted">
          匯出／匯入 JSON 備份，可在裝置間搬移或還原持倉。
          {storageMode === "cloud"
            ? " 雲端同步已開啟，匯入後的變更也會同步。"
            : " 僅影響本機瀏覽器儲存。"}
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={handleExport}
            className="touch-target rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            匯出 JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="touch-target rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            匯入 JSON
          </button>
          {storageMode !== "anonymous" && (
            <button
              type="button"
              onClick={() => void refreshFromCloud()}
              disabled={syncStatus === "syncing"}
              className="touch-target rounded-lg border border-accent/40 bg-accent-dim/20 px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent-dim/40"
            >
              {storageMode === "cloud" ? "查看雲端版本" : "啟用雲端同步"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <p className="mt-3 text-xs text-muted">
          目前：{describePortfolioStorage(storage)}
        </p>

        {message && !confirm && (
          <p role={message.type === "error" ? "alert" : "status"}
            className={`mt-2 text-sm ${
              message.type === "error" ? "text-rose-500" : "text-accent"
            }`}
          >
            {message.text}
          </p>
        )}
      </section>

      {confirm && (
        <Modal labelledBy="import-confirm-title" onClose={() => setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-page p-5 shadow-xl">
            <h2 id="import-confirm-title" className="text-lg font-semibold">
              確認匯入
            </h2>
            <p className="mt-2 text-sm text-muted">
              備份檔含 {confirm.summary}。目前為{" "}
              {describePortfolioStorage(storage)}。
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">匯入方式</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-dim/30">
                <input
                  type="radio"
                  name="import-mode"
                  checked={confirm.mode === "replace"}
                  onChange={() =>
                    setConfirm((c) => c && { ...c, mode: "replace" })
                  }
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium text-foreground">取代全部</span>
                  <span className="mt-0.5 block text-muted">
                    以備份取代持倉、貸款、交易與價格歷史，保留目前的外觀設定。
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-dim/30">
                <input
                  type="radio"
                  name="import-mode"
                  checked={confirm.mode === "merge"}
                  onChange={() =>
                    setConfirm((c) => c && { ...c, mode: "merge" })
                  }
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium text-foreground">合併</span>
                  <span className="mt-0.5 block text-muted">
                    補入缺少的紀錄。同筆持倉、貸款及交易採較新的版本，已有的同日價格與目前設定會保留。
                  </span>
                </span>
              </label>
            </fieldset>

            {message?.type === "error" && <p role="alert" className="mt-3 text-sm text-loss">{message.text}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={runImport}
                disabled={importing}
                className="touch-target rounded-lg bg-accent-button px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
              >
                {importing ? "儲存中…" : "確認匯入"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="touch-target rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:bg-surface-raised"
              >
                取消
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
