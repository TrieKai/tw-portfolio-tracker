"use client";

import { FormEvent, useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatCurrency, formatQuotePrice } from "@/lib/portfolio/calculations";
import type { HoldingWithMetrics, SellHoldingInput } from "@/lib/types/holding";

export function SellHoldingModal({
  holding,
  onSave,
  onClose,
}: {
  holding: HoldingWithMetrics;
  onSave: (input: SellHoldingInput) => void;
  onClose: () => void;
}) {
  const unitLabel = holding.assetType === "stock" ? "股" : "單位";
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [sellPrice, setSellPrice] = useState(
    holding.currentPrice !== undefined ? String(holding.currentPrice) : ""
  );
  const [sellDate, setSellDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);
    if (
      Number.isNaN(qty) ||
      qty <= 0 ||
      Number.isNaN(price) ||
      price <= 0
    ) {
      return null;
    }
    const proceeds = price * qty;
    const cost = holding.buyPrice * qty;
    const realizedPnl = proceeds - cost;
    const isFullSell = qty >= holding.quantity;
    return { proceeds, realizedPnl, isFullSell };
  }, [quantity, sellPrice, holding.buyPrice, holding.quantity]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);

    if (Number.isNaN(qty) || qty <= 0) {
      setError("請輸入有效賣出數量");
      return;
    }
    if (qty > holding.quantity) {
      setError(`賣出數量不可超過持有 ${holding.quantity} ${unitLabel}`);
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setError("請輸入有效賣出價格");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sellDate)) {
      setError("日期格式應為 YYYY-MM-DD");
      return;
    }

    onSave({
      id: holding.id,
      quantity: qty,
      sellPrice: price,
      sellDate,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="sell-holding-title"
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="sell-holding-title" className="font-semibold">
          賣出持倉
        </h3>
        <p className="text-sm text-muted">
          {holding.name}（{holding.symbol}）· 持有 {holding.quantity}{" "}
          {unitLabel} · 成本均價{" "}
          {formatQuotePrice(holding.buyPrice, holding.assetType)}
        </p>

        <label className="block text-sm">
          <span className="text-muted">
            賣出數量（{unitLabel}）<span className="text-rose-500"> *</span>
          </span>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              step="any"
              min="0"
              max={holding.quantity}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field min-w-0 flex-1"
              required
            />
            <button
              type="button"
              onClick={() => setQuantity(String(holding.quantity))}
              className="btn-secondary shrink-0 text-xs"
            >
              全部
            </button>
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">
              賣出價格<span className="text-rose-500"> *</span>
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className="input-field mt-1"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">
              賣出日期<span className="text-rose-500"> *</span>
            </span>
            <div className="mt-1">
              <DatePicker
                value={sellDate}
                onChange={setSellDate}
                max={todayIsoDate()}
              />
            </div>
          </label>
        </div>

        {preview && (
          <div className="rounded-lg border border-border/80 bg-surface-raised/40 p-3 text-sm">
            <p className="tabular-nums">
              預估成交金額：{formatCurrency(preview.proceeds)}
            </p>
            <p
              className={`mt-1 tabular-nums font-medium ${
                preview.realizedPnl >= 0 ? "text-gain" : "text-loss"
              }`}
            >
              預估實現損益：{formatCurrency(preview.realizedPnl)}
            </p>
            {preview.isFullSell && (
              <p className="mt-2 text-xs text-muted">
                將賣出全部持有，此筆持倉會從列表移除
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" className="btn-primary">
            確認賣出
          </button>
        </div>
      </form>
    </div>
  );
}
