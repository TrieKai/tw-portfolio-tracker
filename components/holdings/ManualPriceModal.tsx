"use client";

import { Modal } from "@/components/ui/Modal";
import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { getManualPriceLabel } from "@/lib/portfolio/asset-labels";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import type { AssetType } from "@/lib/types/holding";

export function ManualPriceModal({
  symbol,
  name,
  assetType = "stock",
  defaultPrice,
  defaultDate,
  onSave,
  onClose,
}: {
  symbol: string;
  name: string;
  assetType?: AssetType;
  defaultPrice?: number;
  defaultDate?: string;
  onSave: (price: number, date: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(
    defaultPrice !== undefined ? String(defaultPrice) : ""
  );
  const [date, setDate] = useState(defaultDate ?? todayIsoDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoDate();
  const earliest = priceHistoryStartDate(today);
  const historical = defaultPrice !== undefined && !!defaultDate && !!date && date < defaultDate;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const n = Number.parseFloat(price);
    if (!Number.isFinite(n) || n <= 0) {
      setError("請輸入有效價格");
      return;
    }
    if (!parseIsoDate(date) || date > today) {
      setError("請選擇今天或更早的價格日期。");
      return;
    }
    if (historical && date < earliest) {
      setError(`歷史價格僅保留最近三年，請選擇 ${earliest} 或之後的日期。`);
      return;
    }
    setSaving(true);
    const saved = await onSave(n, date);
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
  }

  return (
    <Modal labelledBy="manual-price-title" onClose={onClose}>
      <form
        onSubmit={handleSubmit}
        className="glass-card w-full max-w-md space-y-4 rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="manual-price-title" className="font-semibold">
          {assetType === "property" ? "更新估價" : "手動輸入價格"}
        </h3>
        <p className="text-sm text-muted">
          {name}（{symbol}）
        </p>

        <label className="block text-sm">
          <span className="text-muted">{getManualPriceLabel(assetType)}</span>
          <input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setError(null);
            }}
            className="input-field mt-1"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted">價格日期</span>
          <div className="mt-1">
            <DatePicker
              value={date}
              onChange={(value) => {
                setDate(value);
                setError(null);
              }}
              max={today}
              required
            />
          </div>
        </label>

        {historical && date >= earliest && (
          <p role="status" className="text-sm text-muted">
            將補入歷史價格。{assetType === "property" ? "最新估價" : "現價"}日期仍為{" "}
            <time dateTime={defaultDate} className="whitespace-nowrap tabular-nums">{defaultDate}</time>。
          </p>
        )}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            儲存
          </button>
        </div>
      </form>
    </Modal>
  );
}
