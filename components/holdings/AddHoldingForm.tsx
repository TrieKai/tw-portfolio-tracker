"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetType, StockMarket } from "@/lib/types/holding";
import { isValidStockSymbolInput } from "@/lib/prices/stock-symbol";
import {
  getAssetTypeLabel,
  getBuyPriceLabel,
  getQuantityLabel,
} from "@/lib/portfolio/asset-labels";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import {
  ResolvedInstrumentName,
  resolveInstrumentName,
} from "./ResolvedInstrumentName";

const ASSET_TYPES = ["stock", "fund", "property"] as const satisfies readonly AssetType[];

export function AddHoldingForm() {
  const router = useRouter();
  const { add, updateOne } = usePortfolio();

  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [market, setMarket] = useState<StockMarket>("tse");
  const [buyPrice, setBuyPrice] = useState("");
  const [currentEstimate, setCurrentEstimate] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [buyDate, setBuyDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isProperty = assetType === "property";

  function handleAssetTypeChange(t: AssetType) {
    setAssetType(t);
    setSymbol("");
    setPropertyName("");
    setResolvedName("");
    setCurrentEstimate("");
    setQuantity(t === "property" ? "1" : "");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const price = Number.parseFloat(buyPrice);
    const qty = Number.parseFloat(quantity);
    const estimate = currentEstimate.trim()
      ? Number.parseFloat(currentEstimate)
      : NaN;

    if (isProperty) {
      if (!propertyName.trim()) {
        setError("請輸入房產名稱或地址");
        return;
      }
    } else if (!symbol.trim()) {
      setError("請輸入代號");
      return;
    }

    if (assetType === "stock" && !isValidStockSymbolInput(symbol)) {
      setError("股票代號格式無效（例：2330、00878、00631L）");
      return;
    }
    if (Number.isNaN(price) || price <= 0) {
      setError(`${getBuyPriceLabel(assetType)}無效`);
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      setError("數量無效");
      return;
    }
    if (
      isProperty &&
      currentEstimate.trim() &&
      (Number.isNaN(estimate) || estimate <= 0)
    ) {
      setError("現估總價無效");
      return;
    }

    setSubmitting(true);

    if (isProperty) {
      const value =
        !Number.isNaN(estimate) && estimate > 0 ? estimate : price;
      add(
        {
          assetType: "property",
          name: propertyName.trim(),
          symbol: symbol.trim(),
          buyPrice: price,
          quantity: qty,
          buyDate,
        },
        { initialPrice: value, initialPriceDate: todayIsoDate() }
      );

      setSubmitting(false);
      router.push("/holdings");
      return;
    }

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
        {ASSET_TYPES.map((t) => (
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
            {getAssetTypeLabel(t)}
          </button>
        ))}
      </div>

      {isProperty ? (
        <>
          <Field label="房產名稱或地址" required>
            <input
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              placeholder="例：台北市大安區…"
              className="input-field"
            />
          </Field>
          <Field label="代號（選填）">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="自訂簡稱，留空則自動產生"
              className="input-field font-mono"
            />
          </Field>
        </>
      ) : (
        <>
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
            onResolved={(name) => setResolvedName(name)}
          />
        </>
      )}

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
        <Field label={getBuyPriceLabel(assetType)} required>
          <input
            type="number"
            step="any"
            min="0"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
            className="input-field"
          />
        </Field>
        <Field label={getQuantityLabel(assetType)} required>
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
        <Field label="現估總價（選填）">
          <input
            type="number"
            step="any"
            min="0"
            value={currentEstimate}
            onChange={(e) => setCurrentEstimate(e.target.value)}
            placeholder="留空則以購入總價作為初始估價"
            className="input-field"
          />
        </Field>
      )}

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
        disabled={
          submitting ||
          (isProperty ? !propertyName.trim() : !symbol.trim())
        }
        className="btn-primary w-full"
      >
        {submitting ? "儲存中…" : "新增持倉"}
      </button>

      {!isProperty && resolvedName && (
        <p className="text-center text-xs text-muted">
          將以「{resolvedName}」儲存
        </p>
      )}

      {isProperty && (
        <p className="text-center text-xs text-muted">
          房子無法自動更新價格，請定期手動更新估價
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
