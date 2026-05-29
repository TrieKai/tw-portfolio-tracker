"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";

export function ManualPriceModal({
  symbol,
  name,
  defaultPrice,
  defaultDate,
  onSave,
  onClose,
}: {
  symbol: string;
  name: string;
  defaultPrice?: number;
  defaultDate?: string;
  onSave: (price: number, date: string) => void;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(
    defaultPrice !== undefined ? String(defaultPrice) : ""
  );
  const [date, setDate] = useState(defaultDate ?? todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number.parseFloat(price);
    if (Number.isNaN(n) || n <= 0) {
      setError("請輸入有效價格");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("日期格式應為 YYYY-MM-DD");
      return;
    }
    onSave(n, date);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card w-full max-w-md space-y-4 rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 className="font-semibold">手動輸入價格</h3>
        <p className="text-sm text-muted">
          {name}（{symbol}）
        </p>

        <label className="block text-sm">
          <span className="text-muted">最新價格 / 淨值</span>
          <input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="input-field mt-1"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted">價格日期</span>
          <div className="mt-1">
            <DatePicker
              value={date}
              onChange={setDate}
              max={todayIsoDate()}
            />
          </div>
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" className="btn-primary">
            儲存
          </button>
        </div>
      </form>
    </div>
  );
}
