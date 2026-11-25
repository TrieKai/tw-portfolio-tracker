"use client";

import { Modal } from "@/components/ui/Modal";
import { useState, type FormEvent } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { addDaysToIsoDate, parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { isDividendDateInPosition, type DividendLot } from "@/lib/portfolio/dividend-lots";
import type { CashDividendInput } from "@/lib/types/holding";

export function DividendModal({
  lots,
  onSave,
  onClose,
}: {
  lots: DividendLot[];
  onSave: (input: CashDividendInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [holdingId, setHoldingId] = useState(lots[0]?.id ?? "");
  const [effectiveDate, setEffectiveDate] = useState(lots[0]?.closedOn ? "" : todayIsoDate());
  const [settlementDate, setSettlementDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = lots.find((lot) => lot.id === holdingId);
  const today = todayIsoDate();
  const latestDate = selected?.closedOn && selected.closedOn < today ? selected.closedOn : today;
  const earliestDate = selected?.buyDate ? addDaysToIsoDate(selected.buyDate, 1) : undefined;

  function selectLot(id: string) {
    const lot = lots.find((item) => item.id === id);
    setHoldingId(id);
    setError(null);
    if (!lot || (effectiveDate && !isDividendDateInPosition(lot, effectiveDate))) setEffectiveDate("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsedAmount = Number.parseFloat(amount);
    if (!selected) {
      setError("請選擇股票或基金");
      return;
    }
    if (!isDividendDateInPosition(selected, effectiveDate) || effectiveDate > today) {
      setError("請填持有期間內的除息日。");
      return;
    }
    if (settlementDate && (!parseIsoDate(settlementDate) || settlementDate < effectiveDate)) {
      setError("入帳日須在除息日當日或之後。");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("請輸入有效的實收配息總額");
      return;
    }
    setSaving(true);
    const saved = await onSave({
      holdingId,
      effectiveDate,
      settlementDate: settlementDate || undefined,
      amount: parsedAmount,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
    if (saved) onClose();
  }

  return (
    <Modal labelledBy="dividend-modal-title" onClose={onClose} dismissOnBackdrop>
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
            onChange={(event) => selectLot(event.target.value)}
            className="input-field mt-1"
            required
          >
            {lots.map((holding) => (
              <option key={holding.id} value={holding.id}>
                {holding.name}（{holding.symbol}）{holding.closedOn ? ` · 已出清 ${holding.closedOn}` : ""}
              </option>
            ))}
          </select>
        </label>

        {selected?.closedOn && (
          <p className="text-sm text-muted">
            {selected.buyDate ? `可補登 ${selected.closedOn} 前持有期間的配息。` : "這筆舊紀錄缺少買入日，請依成交與配息明細核對除息日。"}
          </p>
        )}

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
                min={earliestDate}
                max={latestDate}
                required
              />
            </div>
          </label>
          <label className="block text-sm">
            <span className="text-muted">實際入帳日（選填）</span>
            <div className="mt-1">
              <DatePicker
                value={settlementDate}
                onChange={setSettlementDate}
                min={effectiveDate || undefined}
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

        {error ? <p role="alert" className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            儲存配息
          </button>
        </div>
      </form>
    </Modal>
  );
}
