"use client";

import { useState, type FormEvent } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import type { CashDividendInput, HoldingWithMetrics } from "@/lib/types/holding";

export function DividendModal({
  holdings,
  onSave,
  onClose,
}: {
  holdings: HoldingWithMetrics[];
  onSave: (input: CashDividendInput) => void;
  onClose: () => void;
}) {
  const [holdingId, setHoldingId] = useState(holdings[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [settlementDate, setSettlementDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number.parseFloat(amount);
    if (!holdingId) {
      setError("請選擇股票或基金");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("請輸入有效的實收配息總額");
      return;
    }
    onSave({
      holdingId,
      effectiveDate,
      settlementDate: settlementDate || undefined,
      amount: parsedAmount,
      note: note.trim() || undefined,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dividend-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full space-y-4 overflow-y-auto rounded-b-none p-5 sm:max-w-lg sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="dividend-modal-title" className="text-lg font-semibold">
              新增股利／配息
            </h2>
            <p className="mt-1 text-sm text-muted">
              收益歸屬除息日；入帳日只用於明細註記。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-lg text-muted hover:bg-surface-raised hover:text-foreground"
            aria-label="關閉"
          >
            ×
          </button>
        </div>

        <label className="block text-sm">
          <span className="text-muted">股票或基金</span>
          <select
            value={holdingId}
            onChange={(event) => setHoldingId(event.target.value)}
            className="input-field mt-1"
            required
          >
            {holdings.map((holding) => (
              <option key={holding.id} value={holding.id}>
                {holding.name}（{holding.symbol}）
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-muted">實收總額</span>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="input-field mt-1"
            placeholder="請填實際收到的總金額"
            required
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">除息日</span>
            <div className="mt-1">
              <DatePicker
                value={effectiveDate}
                onChange={setEffectiveDate}
                max={todayIsoDate()}
              />
            </div>
          </label>
          <label className="block text-sm">
            <span className="text-muted">實際入帳日（選填）</span>
            <div className="mt-1">
              <DatePicker
                value={settlementDate}
                onChange={setSettlementDate}
              />
            </div>
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-muted">備註（選填）</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="input-field mt-1"
            placeholder="例：2026 年第 2 季配息"
          />
        </label>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" className="btn-primary">
            儲存配息
          </button>
        </div>
      </form>
    </div>
  );
}
