"use client";

import { getSellUnitLabel } from "@/lib/portfolio/asset-labels";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { Modal } from "@/components/ui/Modal";
import { useCallback, useRef, useState } from "react";
import {
  describePortfolioStorage,
  downloadPortfolioExport,
  readPortfolioImportFile,
  type PortfolioImportMode,
  type SaleImportChoice,
  type SaleImportChoices,
  type SaleImportConflict,
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
  const [conflicts, setConflicts] = useState<SaleImportConflict[]>([]);
  const [choices, setChoices] = useState<SaleImportChoices>({});
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

      setConflicts([]);
      setChoices({});
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
    const result = await importPortfolio(confirm.portfolio, confirm.mode, choices);
    setImporting(false);
    if (result.status === "review") {
      setConflicts(result.conflicts);
      setChoices((previous) => Object.fromEntries(
        result.conflicts.flatMap((conflict) =>
          previous[conflict.key] && (previous[conflict.key] !== "both" || conflict.canKeepBoth)
            ? [[conflict.key, previous[conflict.key]]] : []
        )
      ));
      return;
    }
    if (result.status === "failed") {
      setMessage({ type: "error", text: "未能儲存備份資料。若本機資料已損毀，可選擇取代全部。也請確認瀏覽器儲存空間。" });
      return;
    }
    setMessage({
      type: "ok",
      text: confirm.mode === "replace" ? "已用備份取代資料。" : "備份已合併。",
    });
    setConfirm(null);
  }, [confirm, choices, importing, importPortfolio]);

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
        <Modal labelledBy="import-confirm-title" onClose={importing ? undefined : () => setConfirm(null)}>
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-page p-5 shadow-xl">
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
                    補入缺少的紀錄，並依賣出紀錄核對剩餘持倉。價格會按公司行動換算，已有的同日價格與目前設定會保留。
                  </span>
                </span>
              </label>
            </fieldset>

            {confirm.mode === "merge" && conflicts.length > 0 && (
              <SaleReview
                conflicts={conflicts}
                choices={choices}
                disabled={importing}
                onChoose={(key, choice) => setChoices((previous) => ({ ...previous, [key]: choice }))}
              />
            )}
            {message?.type === "error" && <p role="alert" className="mt-3 text-sm text-loss">{message.text}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                onClick={runImport}
                disabled={importing || (confirm.mode === "merge" && conflicts.some((conflict) => !choices[conflict.key]))}
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


function SaleReview({
  conflicts,
  choices,
  disabled,
  onChoose,
}: {
  conflicts: SaleImportConflict[];
  choices: SaleImportChoices;
  disabled: boolean;
  onChoose: (key: string, choice: SaleImportChoice) => void;
}) {
  const { formatAmount, formatQuoteAmount } = useAmountPrivacy();
  return (
    <section className="mt-5 space-y-3" aria-labelledby="sale-review-title">
      <h3 id="sale-review-title" className="font-semibold">核對疑似重複成交</h3>
      <p role="status" className="text-sm text-muted">
        同一批持倉出現日期、數量與單價相同的賣出紀錄。請確認要保留哪一邊的成交。
      </p>
      {conflicts.map((conflict, index) => {
        const sale = conflict.local[0];
        const options = [
          { choice: "local" as const, label: "保留本機", sales: conflict.local },
          { choice: "backup" as const, label: "保留備份", sales: conflict.backup },
        ];
        return (
          <fieldset key={conflict.key} disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
            <legend className="max-w-full break-words px-1 text-sm font-medium">{sale.name}（{sale.symbol}）</legend>
            <p className="text-sm text-muted">
              {sale.sellDate} · 每筆 {sale.quantity} {getSellUnitLabel(sale.assetType)} · {formatQuoteAmount(sale.sellPrice, sale.assetType)}
            </p>
            {options.map(({ choice, label, sales }) => (
              <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <input type="radio" name={`sale-conflict-${index}`} checked={choices[conflict.key] === choice}
                  onChange={() => onChoose(conflict.key, choice)} />
                <span>{label} · {sales.length} 筆 · 已實現 {formatAmount(sales.reduce((sum, item) => sum + item.realizedPnl, 0))}</span>
              </label>
            ))}
            {conflict.canKeepBoth && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <input type="radio" name={`sale-conflict-${index}`} checked={choices[conflict.key] === "both"}
                  onChange={() => onChoose(conflict.key, "both")} />
                <span>兩邊是不同成交，全部保留</span>
              </label>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
