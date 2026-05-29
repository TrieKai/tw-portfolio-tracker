"use client";

import { FormEvent, useState } from "react";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import type { EditHoldingInput } from "@/lib/types/holding";
import { isValidStockSymbolInput } from "@/lib/prices/stock-symbol";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import {
  ResolvedInstrumentName,
  resolveInstrumentName,
} from "./ResolvedInstrumentName";

export function EditHoldingModal({
  holding,
  onSave,
  onClose,
}: {
  holding: HoldingWithMetrics;
  onSave: (input: EditHoldingInput) => void;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState(holding.symbol);
  const [resolvedName, setResolvedName] = useState(holding.name);
  const [market, setMarket] = useState(holding.market ?? "tse");
  const [buyPrice, setBuyPrice] = useState(String(holding.buyPrice));
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [buyDate, setBuyDate] = useState(holding.buyDate);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isStock = holding.assetType === "stock";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const price = Number.parseFloat(buyPrice);
    const qty = Number.parseFloat(quantity);

    if (!symbol.trim()) {
      setError("請輸入代號");
      return;
    }
    if (isStock && !isValidStockSymbolInput(symbol)) {
      setError("股票代號格式無效（例：2330、00878、00631L）");
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setError("買入價格無效");
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      setError("數量無效");
      return;
    }

    setSubmitting(true);

    const lookup = await resolveInstrumentName(
      holding.assetType,
      symbol,
      isStock ? market : undefined
    );

    setSubmitting(false);

    if (!lookup.ok) {
      setError(lookup.error);
      return;
    }

    onSave({
      id: holding.id,
      assetType: holding.assetType,
      name: lookup.name,
      symbol: lookup.symbol,
      market: isStock ? market : undefined,
      buyPrice: price,
      quantity: qty,
      buyDate,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="edit-holding-title"
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="edit-holding-title" className="font-semibold">
          編輯持倉
        </h3>
        <p className="text-sm text-muted">
          {isStock ? "台股" : "境內基金"} · 類型不可變更 · 名稱由代號自動查詢
        </p>

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

        <ResolvedInstrumentName
          assetType={holding.assetType}
          symbol={symbol}
          market={market}
          initialName={holding.name}
          onResolved={(name) => setResolvedName(name)}
        />

        {isStock && (
          <Field label="市場">
            <select
              value={market}
              onChange={(e) =>
                setMarket(e.target.value as "tse" | "otc")
              }
              className="input-field"
            >
              <option value="tse">上市（TSE）</option>
              <option value="otc">上櫃（OTC）</option>
            </select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="買入價格" required>
            <input
              type="number"
              step="any"
              min="0"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              className="input-field"
            />
          </Field>
          <Field label={isStock ? "股數" : "單位數"} required>
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

        <Field label="買入日期" required>
          <DatePicker
            value={buyDate}
            onChange={setBuyDate}
            max={todayIsoDate()}
          />
        </Field>

        {error && <p className="text-sm text-rose-500">{error}</p>}

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

        {resolvedName && (
          <p className="text-center text-xs text-muted">
            將以「{resolvedName}」儲存
          </p>
        )}
      </form>
    </div>
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
