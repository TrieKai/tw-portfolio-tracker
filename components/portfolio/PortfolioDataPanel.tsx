"use client";

import { getSellUnitLabel } from "@/lib/portfolio/asset-labels";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Modal } from "@/components/ui/Modal";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  describePortfolioStorage,
  downloadPortfolioExport,
  readPortfolioImportFile,
  isPortfolioImportChoiceAllowed,
  type PortfolioImportMode,
  type PortfolioImportConflict,
  type LoanPaymentImportConflict,
  type SaleImportChoice,
  type PortfolioImportChoices,
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
  const fileSelection = useRef(0);
  const reviewRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [conflicts, setConflicts] = useState<PortfolioImportConflict[]>([]);
  const [choices, setChoices] = useState<PortfolioImportChoices>({});
  const [confirm, setConfirm] = useState<ImportConfirmState | null>(null);
  const importMode = confirm?.mode;

  useEffect(() => {
    if (importMode === "merge" && conflicts.length) {
      reviewRef.current?.querySelector("h3")?.focus();
    }
  }, [importMode, conflicts]);

  const chooseRecord = (key: string, choice: PortfolioImportChoices[string]) => {
    setChoices((previous) => ({ ...previous, [key]: choice }));
  };

  const handleExport = useCallback(() => {
    downloadPortfolioExport(storage);
    setMessage({ type: "ok", text: "已下載備份 JSON 檔" });
  }, [storage]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const selection = ++fileSelection.current;
      setConfirm(null);
      setMessage(null);
      const parsed = await readPortfolioImportFile(file);
      if (selection !== fileSelection.current) return;
      if (!parsed.ok) {
        setMessage({ type: "error", text: `${parsed.error.replace(/。$/, "")}。請重新匯出備份或改用其他 JSON 檔。` });
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
          isPortfolioImportChoiceAllowed(conflict, previous[conflict.key])
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

        {message && !confirm && (message.type === "error" ? (
          <div className="mt-3 [overflow-wrap:anywhere]">
            <ErrorAlert title="無法匯入備份" message={message.text} />
          </div>
        ) : <p role="status" className="mt-2 text-sm text-accent">{message.text}</p>)}
      </section>

      {confirm && (
        <Modal labelledBy="import-confirm-title" onClose={importing ? undefined : () => setConfirm(null)}>
          <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-page shadow-xl">
            <div className="min-h-0 overflow-y-auto px-5 pb-4 pt-5">
              <h2 id="import-confirm-title" className="text-lg font-semibold">
                確認匯入
              </h2>
              <p className="mt-2 text-sm text-muted">
                備份檔含 {confirm.summary}。目前為{" "}
                {describePortfolioStorage(storage)}。
              </p>

              <fieldset disabled={importing} className="mt-4 space-y-2">
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
                      補入缺少的紀錄。疑似重複的賣出和繳款需先核對，已有的同日價格與目前設定會保留。
                    </span>
                  </span>
                </label>
              </fieldset>

              {confirm.mode === "merge" && conflicts.length > 0 && (
                <div ref={reviewRef}>
                  <SaleReview conflicts={conflicts.filter((conflict) => conflict.kind !== "loan_payment")}
                    choices={choices} disabled={importing} onChoose={chooseRecord} />
                  <LoanPaymentReview conflicts={conflicts.filter((conflict) => conflict.kind === "loan_payment")}
                    choices={choices} disabled={importing} onChoose={chooseRecord} />
                </div>
              )}
              {message?.type === "error" && <p role="alert" className="mt-3 text-sm text-loss">{message.text}</p>}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={importing}
                className="touch-target rounded-lg border border-border px-4 py-2.5 text-sm text-muted enabled:hover:bg-surface-raised disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={importing || (confirm.mode === "merge" && conflicts.some((conflict) => !isPortfolioImportChoiceAllowed(conflict, choices[conflict.key])))}
                className="touch-target flex-1 rounded-lg bg-accent-button px-4 py-2.5 text-sm font-semibold text-white enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {importing ? "儲存中…" : "確認匯入"}
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
  choices: PortfolioImportChoices;
  disabled: boolean;
  onChoose: (key: string, choice: SaleImportChoice) => void;
}) {
  const { formatAmount, formatQuoteAmount } = useAmountPrivacy();
  if (!conflicts.length) return null;
  const hasOversold = conflicts.some((conflict) => conflict.kind === "oversold");
  return (
    <section className="mt-5 space-y-3" aria-labelledby="sale-review-title">
      <h3 id="sale-review-title" tabIndex={-1} className="font-semibold">{hasOversold ? "核對賣出成交" : "核對疑似重複成交"}</h3>
      <p role="status" className="text-sm text-muted">
        {hasOversold
          ? "合併的成交超過可核對的買入數量。請選擇要保留哪一邊的成交。"
          : "同一批持倉出現日期、數量與單價相同的賣出紀錄。請確認要保留哪一邊的成交。"}
      </p>
      {conflicts.map((conflict, index) => {
        const sale = conflict.local[0] ?? conflict.backup[0];
        const isOversold = conflict.kind === "oversold";
        const options = [
          { choice: "local" as const, label: "保留本機成交", sales: conflict.local },
          { choice: "backup" as const, label: "保留備份成交", sales: conflict.backup },
        ];
        return (
          <fieldset key={conflict.key} disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
            <legend className="max-w-full break-words px-1 text-sm font-medium">{sale.name}（{sale.symbol}）</legend>
            <p className="text-sm text-muted">
              {isOversold
                ? `換算後合計賣出 ${conflict.mergedQuantity?.toLocaleString("zh-TW")} ${getSellUnitLabel(sale.assetType)}，原始持倉只有 ${conflict.capacity?.toLocaleString("zh-TW")} ${getSellUnitLabel(sale.assetType)}。`
                : `${sale.sellDate} · 每筆 ${sale.quantity} ${getSellUnitLabel(sale.assetType)} · ${formatQuoteAmount(sale.sellPrice, sale.assetType)}`}
            </p>
            {options.filter(({ choice }) => isPortfolioImportChoiceAllowed(conflict, choice)).map(({ choice, label, sales }) => (
              <label key={choice} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <input type="radio" className="mt-1" name={`sale-conflict-${index}`} checked={choices[conflict.key] === choice}
                  onChange={() => onChoose(conflict.key, choice)} />
                <span className="min-w-0">
                  <span>{label} · {sales.length} 筆 · 已實現 {formatAmount(sales.reduce((sum, item) => sum + item.realizedPnl, 0))}</span>
                  {isOversold && sales.map((record) => (
                    <span key={record.id} className="mt-1 block text-muted">
                      {record.sellDate} · {record.quantity} {getSellUnitLabel(record.assetType)} · {formatQuoteAmount(record.sellPrice, record.assetType)}
                    </span>
                  ))}
                </span>
              </label>
            ))}
            {conflict.canKeepLocal === false && conflict.canKeepBackup === false && (
              <p role="alert" className="text-sm text-loss">兩邊的成交都超過可確認的持倉，請先更正交易資料。</p>
            )}
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

const paymentRecordedAt = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "short", timeStyle: "medium", hourCycle: "h23",
});

function LoanPaymentReview({
  conflicts, choices, disabled, onChoose,
}: {
  conflicts: LoanPaymentImportConflict[];
  choices: PortfolioImportChoices;
  disabled: boolean;
  onChoose: (key: string, choice: string[]) => void;
}) {
  const { formatAmount } = useAmountPrivacy();
  if (!conflicts.length) return null;

  return (
    <section className="mt-5 space-y-3" aria-labelledby="payment-review-title">
      <h3 id="payment-review-title" tabIndex={-1} className="font-semibold">核對疑似重複繳款</h3>
      <p className="text-sm text-muted">
        請依帳單勾選要保留的繳款。同一筆選一項，分開繳款可選多項。
      </p>
      {conflicts.map((conflict) => {
        const choice = choices[conflict.key];
        const selected = Array.isArray(choice) ? choice : [];
        const payment = conflict.local[0];
        const records = [
          ...conflict.local.map((record) => ({ record, source: "本機" })),
          ...conflict.backup.map((record) => ({ record, source: "備份" })),
        ];
        return (
          <fieldset key={conflict.key} disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
            <legend className="max-w-full break-words px-1 text-sm font-medium">{conflict.loanName}</legend>
            <div className="text-sm tabular-nums">
              <p className="font-medium">繳款日 {payment.paymentDate}</p>
              <p className="text-muted">
                還本 {formatAmount(payment.principalPaid)} · 利息 {formatAmount(payment.interestPaid)} · 費用 {formatAmount(payment.feePaid)}
                {payment.subsidyReceived > 0 && ` · 補貼 ${formatAmount(payment.subsidyReceived)}`}
                {payment.remainingPrincipalAfter !== undefined && ` · 繳款後本金 ${formatAmount(payment.remainingPrincipalAfter)}`}
              </p>
            </div>
            {records.map(({ record, source }) => {
              const checked = selected.includes(record.id);
              const recordedAt = Date.parse(record.createdAt);
              return (
                <label key={record.id} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-3 py-2 hover:bg-surface-raised has-[:checked]:bg-accent-dim/30">
                  <input type="checkbox" className="mt-1 shrink-0" checked={checked}
                    onChange={(event) => onChoose(conflict.key, event.target.checked
                      ? [...selected, record.id] : selected.filter((id) => id !== record.id))} />
                  <span className="min-w-0 break-words">
                    <span className="font-medium">保留{source}繳款</span>
                    {Number.isFinite(recordedAt) && (
                      <span className="block text-sm text-muted">登錄於 {paymentRecordedAt.format(recordedAt)}</span>
                    )}
                    {record.installmentDueDate && (
                      <span className="block text-sm text-muted">對應期別 {record.installmentDueDate}</span>
                    )}
                    {record.interestPeriodStartDate && record.interestPeriodEndDate && (
                      <span className="block text-sm text-muted">計息期間 {record.interestPeriodStartDate} 至 {record.interestPeriodEndDate}</span>
                    )}
                    {record.note && <span className="block whitespace-pre-wrap text-sm text-muted">{record.note}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
}
