"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetType, StockMarket } from "@/lib/types/holding";
import { isValidStockSymbolInput } from "@/lib/prices/stock-symbol";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import {
  ResolvedInstrumentName,
  resolveInstrumentName,
} from "./ResolvedInstrumentName";

export function AddHoldingForm() {
  const router = useRouter();
  const { add, updateOne } = usePortfolio();

  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [resolvedSymbol, setResolvedSymbol] = useState("");
  const [market, setMarket] = useState<StockMarket>("tse");
  const [buyPrice, setBuyPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [buyDate, setBuyDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleAssetTypeChange(t: AssetType) {
    setAssetType(t);
    setSymbol("");
    setResolvedName("");
    setResolvedSymbol("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const price = Number.parseFloat(buyPrice);
    const qty = Number.parseFloat(quantity);

    if (!symbol.trim()) {
      setError("請輸入代號");
      return;
    }
    if (assetType === "stock" && !isValidStockSymbolInput(symbol)) {
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
      assetType,
      symbol,
      assetType === "stock" ? market : undefined
    );

    if (!lookup.ok) {
      setError(lookup.error);
      setSubmitting(false);
      return;
    }

    const newId = add({
      assetType,
      name: lookup.name,
      symbol: lookup.symbol,
      market: assetType === "stock" ? market : undefined,
      buyPrice: price,
      quantity: qty,
      buyDate,
    });

    if (newId) {
      await updateOne(newId);
    }

    setSubmitting(false);
    router.push("/holdings");
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card mx-auto w-full max-w-lg space-y-5 p-4 sm:p-6">
      <div className="flex gap-2">
        {(["stock", "fund"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleAssetTypeChange(t)}
            className={`flex-1 rounded-lg border py-2 text-sm font-medium transition ${
              assetType === t
                ? "border-accent bg-accent-dim text-accent"
                : "border-border text-muted hover:border-accent/40"
            }`}
          >
            {t === "stock" ? "台股" : "境內基金"}
          </button>
        ))}
      </div>

      <Field
        label={assetType === "stock" ? "股票代號" : "基金代碼"}
        required
      >
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder={assetType === "stock" ? "2330、00878、00631L" : "18480065"}
          className="input-field font-mono"
          inputMode={assetType === "fund" ? "numeric" : "text"}
        />
      </Field>

      <ResolvedInstrumentName
        assetType={assetType}
        symbol={symbol}
        market={market}
        onResolved={(name, sym) => {
          setResolvedName(name);
          setResolvedSymbol(sym);
        }}
      />

      {assetType === "stock" && (
        <Field label="市場">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as StockMarket)}
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
        <Field label={assetType === "stock" ? "股數" : "單位數"} required>
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

      <button
        type="submit"
        disabled={submitting || !symbol.trim()}
        className="btn-primary w-full"
      >
        {submitting ? "儲存中…" : "新增持倉"}
      </button>

      {resolvedName && (
        <p className="text-center text-xs text-muted">
          將以「{resolvedName}」儲存
        </p>
      )}
    </form>
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
