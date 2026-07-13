"use client";

import { FormEvent, useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatCurrency, formatQuotePrice } from "@/lib/portfolio/calculations";
import { getSellUnitLabel } from "@/lib/portfolio/asset-labels";
import { allocateFifoSell } from "@/lib/portfolio/holding-groups";
import type { HoldingGroupWithMetrics } from "@/lib/portfolio/holding-groups";
import type { SellHoldingInput } from "@/lib/types/holding";

/** 合併標的賣出：依買入日 FIFO 分攤數量 */
export function SellGroupHoldingModal({
  group,
  onSave,
  onClose,
}: {
  group: HoldingGroupWithMetrics;
  onSave: (inputs: SellHoldingInput[]) => void;
  onClose: () => void;
}) {
  const unitLabel = getSellUnitLabel(group.assetType);
  const totalQty = group.quantity;

  const [quantity, setQuantity] = useState(String(totalQty));
  const [sellPrice, setSellPrice] = useState(
    group.currentPrice !== undefined ? String(group.currentPrice) : ""
  );
  const [sellDate, setSellDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  const allocation = useMemo(() => {
    const qty = Number.parseFloat(quantity);
    if (Number.isNaN(qty) || qty <= 0) return [];
    return allocateFifoSell(group.lots, qty);
  }, [quantity, group.lots]);

  const preview = useMemo(() => {
    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);
    if (
      Number.isNaN(qty) ||
      qty <= 0 ||
      Number.isNaN(price) ||
      price <= 0 ||
      allocation.length === 0
    ) {
      return null;
    }
    const proceeds = price * qty;
    const cost = allocation.reduce((s, a) => s + a.buyPrice * a.quantity, 0);
    const realizedPnl = proceeds - cost;
    const isFullSell = qty >= totalQty;
    return { proceeds, realizedPnl, isFullSell, cost };
  }, [quantity, sellPrice, allocation, totalQty]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);

    if (Number.isNaN(qty) || qty <= 0) {
      setError("請輸入有效賣出數量");
      return;
    }
    if (qty > totalQty) {
      setError(`賣出數量不可超過持有 ${totalQty} ${unitLabel}`);
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

    const allocated = allocateFifoSell(group.lots, qty);
    const allocatedQty = allocated.reduce((s, a) => s + a.quantity, 0);
    if (allocatedQty < qty) {
      setError("可賣數量不足");
      return;
    }

    onSave(
      allocated.map((a) => ({
        id: a.id,
        quantity: a.quantity,
        sellPrice: price,
        sellDate,
      }))
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="sell-group-holding-title"
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="sell-group-holding-title" className="font-semibold">
          賣出持倉
        </h3>
        <p className="text-sm text-muted">
          {group.name}（{group.symbol}）· 共 {group.lots.length} 筆買入 · 合計{" "}
          {totalQty} {unitLabel} · 加權均價{" "}
          {formatQuotePrice(group.avgBuyPrice, group.assetType)}
        </p>
        <p className="text-xs text-muted">
          賣出時依買入日先進先出（FIFO）從較早買入分攤。
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
              max={totalQty}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field min-w-0 flex-1"
              required
            />
            <button
              type="button"
              onClick={() => setQuantity(String(totalQty))}
              className="btn-secondary shrink-0 text-xs"
            >
              全部
            </button>
          </div>
        </label>

        {allocation.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-border/80 bg-surface-raised/30 p-3 text-xs text-muted">
            {allocation.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 tabular-nums">
                <span>
                  {a.buyDate} · 成本{" "}
                  {formatQuotePrice(a.buyPrice, group.assetType)}
                </span>
                <span>
                  賣 {a.quantity} {unitLabel}
                </span>
              </li>
            ))}
          </ul>
        )}

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
                將賣出此標的全部持有，相關買入明細會從列表移除
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
