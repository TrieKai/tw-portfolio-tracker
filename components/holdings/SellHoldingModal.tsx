"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { Modal } from "@/components/ui/Modal";
import { FormEvent, useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { holdingSaleTerms } from "@/lib/corporate-actions/adjustment";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { getSellUnitLabel } from "@/lib/portfolio/asset-labels";
import type { HoldingWithMetrics, SellHoldingInput } from "@/lib/types/holding";

export function SellHoldingModal({
  holding,
  onSave,
  onClose,
}: {
  holding: HoldingWithMetrics;
  onSave: (input: SellHoldingInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const { formatAmount, formatQuoteAmount } = useAmountPrivacy();
  const { storage: { corporateActions } } = usePortfolio();
  const unitLabel = getSellUnitLabel(holding.assetType);
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [sellPrice, setSellPrice] = useState(
    holding.currentPrice !== undefined ? String(holding.currentPrice) : ""
  );
  const [sellDate, setSellDate] = useState(todayIsoDate());
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terms = holdingSaleTerms(holding, corporateActions, sellDate);

  function changeSellDate(date: string) {
    if (holdingSaleTerms(holding, corporateActions, date).shareFactor !== terms.shareFactor) {
      setSellPrice("");
    }
    setSellDate(date);
  }

  const preview = useMemo(() => {
    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);
    const feeAmount = fee.trim() ? Number.parseFloat(fee) : 0;
    const taxAmount = tax.trim() ? Number.parseFloat(tax) : 0;
    if (
      Number.isNaN(qty) ||
      qty <= 0 ||
      qty > terms.quantity ||
      Number.isNaN(price) ||
      price <= 0
    ) {
      return null;
    }
    const proceeds = price * qty;
    const cost = terms.buyPrice * qty;
    if (!Number.isFinite(feeAmount) || !Number.isFinite(taxAmount)) return null;
    const realizedPnl = proceeds - cost - feeAmount - taxAmount;
    const isFullSell = qty >= terms.quantity;
    return { proceeds, realizedPnl, isFullSell };
  }, [quantity, sellPrice, fee, tax, terms.buyPrice, terms.quantity]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const qty = Number.parseFloat(quantity);
    const price = Number.parseFloat(sellPrice);
    const feeAmount = fee.trim() ? Number.parseFloat(fee) : 0;
    const taxAmount = tax.trim() ? Number.parseFloat(tax) : 0;

    if (Number.isNaN(qty) || qty <= 0) {
      setError("請輸入有效賣出數量");
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setError("請輸入有效賣出價格");
      return;
    }
    if (!parseIsoDate(sellDate) || sellDate < holding.buyDate || sellDate > todayIsoDate()) {
      setError(`賣出日須介於買入日 ${holding.buyDate} 與今天之間。`);
      return;
    }
    if (qty > terms.quantity) {
      setError(`以成交日數量計算，最多可賣出 ${terms.quantity} ${unitLabel}。`);
      return;
    }
    if (!Number.isFinite(feeAmount) || feeAmount < 0) {
      setError("請輸入有效手續費");
      return;
    }
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
      setError("請輸入有效交易稅");
      return;
    }

    setSaving(true);
    const saved = await onSave({
      id: holding.id,
      quantity: qty,
      sellPrice: price,
      sellDate,
      fee: feeAmount,
      tax: taxAmount,
    });
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
  }

  return (
    <Modal labelledBy="sell-holding-title" onClose={onClose}>
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="sell-holding-title" className="font-semibold">
          賣出持倉
        </h3>
        <p className="text-sm text-muted">
          {holding.name}（{holding.symbol}）· 當日可賣出 {terms.quantity}{" "}
          {unitLabel} · 成本均價{" "}
          {formatQuoteAmount(terms.buyPrice, holding.assetType)}
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
              max={terms.quantity}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field min-w-0 flex-1"
              required
            />
            <button
              type="button"
              onClick={() => setQuantity(String(terms.quantity))}
              disabled={terms.quantity <= 0}
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
                onChange={changeSellDate}
                min={holding.buyDate}
                max={todayIsoDate()}
              />
              <p className="mt-1 text-xs text-muted">數量與單價以成交日為準。</p>
            </div>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">手續費（選填）</span>
            <input
              type="number"
              step="any"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="留空視為 0"
              className="input-field mt-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">交易稅（選填）</span>
            <input
              type="number"
              step="any"
              min="0"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="留空視為 0"
              className="input-field mt-1"
            />
          </label>
        </div>

        {preview && (
          <div className="rounded-lg border border-border/80 bg-surface-raised/40 p-3 text-sm">
            <p className="tabular-nums">
              預估成交金額：{formatAmount(preview.proceeds)}
            </p>
            <p
              className={`mt-1 tabular-nums font-medium ${
                preview.realizedPnl >= 0 ? "text-gain" : "text-loss"
              }`}
            >
              預估實現損益：{formatAmount(preview.realizedPnl)}
            </p>
            {preview.isFullSell && (
              <p className="mt-2 text-xs text-muted">
                將賣出全部持有，此筆持倉會從列表移除
              </p>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            確認賣出
          </button>
        </div>
      </form>
    </Modal>
  );
}
