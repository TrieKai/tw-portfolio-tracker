"use client";

import { Modal } from "@/components/ui/Modal";
import { FormEvent, useState } from "react";
import Link from "next/link";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import type { EditHoldingInput } from "@/lib/types/holding";
import { isValidStockSymbolInput, normalizeStockSymbol } from "@/lib/prices/stock-symbol";
import {
  getAssetTypeLabel,
  getBuyPriceLabel,
  getQuantityLabel,
} from "@/lib/portfolio/asset-labels";
import { DatePicker } from "@/components/ui/DatePicker";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import {
  ResolvedInstrumentName,
  resolveInstrumentName,
} from "./ResolvedInstrumentName";

export function EditHoldingModal({
  holding,
  firstSaleDate,
  onSave,
  onClose,
}: {
  holding: HoldingWithMetrics;
  firstSaleDate?: string;
  onSave: (input: EditHoldingInput, original: HoldingWithMetrics) => Promise<boolean>;
  onClose: () => void;
}) {
  const [original] = useState(holding);
  const [symbol, setSymbol] = useState(holding.symbol);
  const [propertyName, setPropertyName] = useState(holding.name);
  const [resolvedName, setResolvedName] = useState(holding.name);
  const [buyPrice, setBuyPrice] = useState(String(holding.buyPrice));
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [buyDate, setBuyDate] = useState(holding.buyDate);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isStock = holding.assetType === "stock";
  const isProperty = holding.assetType === "property";
  const normalizedSymbol = isStock ? normalizeStockSymbol(symbol) : symbol.replace(/\D/g, "");
  const symbolChanged = !isProperty && normalizedSymbol.length > 0 &&
    normalizedSymbol !== (isStock ? normalizeStockSymbol(original.symbol) : original.symbol);


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!parseIsoDate(buyDate) || buyDate > todayIsoDate()) {
      setError("請輸入有效買入日。");
      return;
    }
    if (firstSaleDate && buyDate > firstSaleDate && buyDate !== original.buyDate) {
      setError(`買入日不得晚於首次賣出日 ${firstSaleDate}。`);
      return;
    }

    const price = Number.parseFloat(buyPrice);
    const qty = Number.parseFloat(quantity);

    if (isProperty) {
      if (!propertyName.trim()) {
        setError("請輸入房產名稱或地址");
        return;
      }
    } else if (!symbol.trim()) {
      setError("請輸入代號");
      return;
    }

    if (isStock && !isValidStockSymbolInput(symbol)) {
      setError("股票代號格式無效（例：2330、00878、00631L）");
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setError(`${getBuyPriceLabel(holding.assetType)}無效`);
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      setError("數量無效");
      return;
    }
    if (isProperty) {
      setSubmitting(true);
      const saved = await onSave({
        id: holding.id,
        assetType: "property",
        name: propertyName.trim(),
        symbol: symbol.trim(),
        buyPrice: price,
        quantity: qty,
        buyDate,
      }, original);
      setSubmitting(false);
      if (!saved) setError("未能儲存。若持倉已在其他分頁變更，請關閉表單後重新編輯。");
      return;
    }

    setSubmitting(true);

    const lookup = await resolveInstrumentName(holding.assetType, symbol);

    if (!lookup.ok) {
      setSubmitting(false);
      setError(lookup.error);
      return;
    }

    const saved = await onSave({
      id: holding.id,
      assetType: holding.assetType,
      name: lookup.name,
      symbol: lookup.symbol,
      market: isStock ? lookup.market : undefined,
      buyPrice: price,
      quantity: qty,
      buyDate,
    }, original);
    setSubmitting(false);
    if (!saved) setError("未能儲存。若持倉已在其他分頁變更，請關閉表單後重新編輯。");
  }

  return (
    <Modal labelledBy="edit-holding-title" onClose={submitting ? undefined : onClose}>
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="edit-holding-title" className="font-semibold">
          編輯持倉
        </h3>
        <p className="text-sm text-muted">
          {getAssetTypeLabel(holding.assetType)} · 類型不可變更
          {isProperty ? " · 名稱自行填寫" : " · 名稱由代號自動查詢"}
        </p>
        {!isProperty && (
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            修改買入價格、數量或日期會被視為更正原始交易，並自更正日期起重新計算損益日曆。
          </p>
        )}

        {isProperty ? (
          <>
            <Field label="房產名稱或地址" required>
              <input
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
                className="input-field"
              />
            </Field>
            <Field label="代號（選填）">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="input-field font-mono"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={isStock ? "股票代號" : "基金代碼"} required>
              <input
                value={symbol}
                onChange={(e) =>
                  setSymbol(
                    isStock ? e.target.value.toUpperCase() : e.target.value
                  )
                }
                className="input-field font-mono"
                inputMode={isStock ? "text" : "numeric"}
              />
            </Field>

            {symbolChanged && (
              <p role="status" className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">
                儲存後會清除原代號的現價與價格歷史，並查詢新標的現價。
              </p>
            )}

            <ResolvedInstrumentName
              assetType={holding.assetType}
              symbol={symbol}
              initialName={symbolChanged ? undefined : holding.name}
              onResolved={(name) => setResolvedName(name)}
            />
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={getBuyPriceLabel(holding.assetType)} required>
            <input
              type="number"
              step="any"
              min="0"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              className="input-field"
            />
          </Field>
          <Field label={getQuantityLabel(holding.assetType)} required>
            <input
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field"
            />
          </Field>
        </div>

        {isProperty && (
          <p className="rounded-lg border border-border bg-surface-raised/60 p-3 text-xs text-muted">
            房貸本金、利率與期限已改由
            <Link href="/loans" className="mx-1 text-accent hover:underline">
              貸款頁
            </Link>
            管理。
          </p>
        )}

        <Field label="買入日期" required>
          <DatePicker
            value={buyDate}
            onChange={setBuyDate}
            max={firstSaleDate && original.buyDate <= firstSaleDate && firstSaleDate < todayIsoDate()
              ? firstSaleDate : todayIsoDate()}
          />
        </Field>

        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? "儲存中…" : "儲存變更"}
          </button>
        </div>

        {!isProperty && resolvedName && (
          <p className="text-center text-xs text-muted">
            將以「{resolvedName}」儲存
          </p>
        )}
      </form>
    </Modal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
