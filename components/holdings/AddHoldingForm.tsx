"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AssetType } from "@/lib/types/holding";
import { isValidStockSymbolInput } from "@/lib/prices/stock-symbol";
import {
  getAssetTypeLabel,
  getBuyPriceLabel,
  getQuantityLabel,
} from "@/lib/portfolio/asset-labels";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { DatePicker } from "@/components/ui/DatePicker";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import {
  ResolvedInstrumentName,
  resolveInstrumentName,
} from "./ResolvedInstrumentName";

const ASSET_TYPES = ["stock", "fund", "property"] as const satisfies readonly AssetType[];

interface HoldingDraft {
  symbol: string;
  propertyName: string;
  buyPrice: string;
  buyFee: string;
  currentEstimate: string;
  mortgageBalance: string;
  quantity: string;
  buyDate: string;
}

function emptyDraft(): HoldingDraft {
  return {
    symbol: "",
    propertyName: "",
    buyPrice: "",
    buyFee: "",
    currentEstimate: "",
    mortgageBalance: "",
    quantity: "1",
    buyDate: todayIsoDate(),
  };
}

export function AddHoldingForm() {
  const router = useRouter();
  const { ready, add, updateOne } = usePortfolio();

  const [assetType, setAssetType] = useState<AssetType>("stock");
  const { formatAmount } = useAmountPrivacy();
  const [drafts, setDrafts] = useState(() => ({
    stock: emptyDraft(),
    fund: emptyDraft(),
    property: emptyDraft(),
  }));
  const draft = drafts[assetType];
  const { symbol, propertyName, buyPrice, buyFee, currentEstimate, mortgageBalance, quantity } = draft;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isProperty = assetType === "property";
  const fee = isProperty ? 0 : Number(buyFee);
  const cost = Number(buyPrice) * Number(quantity) + fee;
  const canPreview = Number(buyPrice) > 0 && Number(quantity) > 0 && fee >= 0 && Number.isFinite(cost);

  function patchDraft(patch: Partial<HoldingDraft>) {
    setDrafts((current) => ({
      ...current,
      [assetType]: { ...current[assetType], ...patch },
    }));
  }

  function handleAssetTypeChange(next: AssetType, form: HTMLFormElement | null) {
    if (next === assetType) return;
    if (form) patchDraft({ buyDate: String(new FormData(form).get("buyDate") ?? "") });
    setAssetType(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || !ready) return;
    setError(null);

    const form = e.currentTarget;
    const buyDate = String(new FormData(form).get("buyDate") ?? "");
    if (!parseIsoDate(buyDate) || buyDate > todayIsoDate()) {
      setError("請選擇有效的買入日期。");
      return;
    }
    const price = Number.parseFloat(buyPrice);
    const qty = Number.parseFloat(quantity);
    const fee = buyFee.trim() ? Number.parseFloat(buyFee) : 0;
    const estimate = currentEstimate.trim()
      ? Number.parseFloat(currentEstimate)
      : NaN;
    const mortgage = mortgageBalance.trim()
      ? Number.parseFloat(mortgageBalance)
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
    if (!Number.isFinite(price) || price <= 0) {
      setError(`${getBuyPriceLabel(assetType)}無效`);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("數量無效");
      return;
    }
    if (!isProperty && (!Number.isFinite(fee) || fee < 0)) {
      setError("買入手續費無效");
      return;
    }
    if (
      isProperty &&
      currentEstimate.trim() &&
      (!Number.isFinite(estimate) || estimate <= 0)
    ) {
      setError("現估總價無效");
      return;
    }
    if (
      isProperty &&
      mortgageBalance.trim() &&
      (!Number.isFinite(mortgage) || mortgage < 0)
    ) {
      setError("房貸餘額無效");
      return;
    }

    if (!canPreview) {
      setError("投入成本超出可計算範圍，請檢查金額與數量。");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    if (isProperty) {
      const value =
        !Number.isNaN(estimate) && estimate > 0 ? estimate : price;
      const id = add(
        {
          assetType: "property",
          name: propertyName.trim(),
          symbol: symbol.trim(),
          buyPrice: price,
          quantity: qty,
          buyDate,
          ...(!Number.isNaN(mortgage) && mortgage > 0
            ? { mortgageBalance: mortgage }
            : {}),
        },
        { initialPrice: value, initialPriceDate: todayIsoDate() }
      );

      if (id) {
        router.push("/holdings");
        return;
      }
      submittingRef.current = false;
      setSubmitting(false);
      setError("資料尚未就緒，請重試儲存。");
      return;
    }

    const lookup = await resolveInstrumentName(assetType, symbol);
    if (!form.isConnected) return;

    if (!lookup.ok) {
      setError(lookup.error);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    const newId = add({
      assetType,
      name: lookup.name,
      symbol: lookup.symbol,
      market: assetType === "stock" ? lookup.market : undefined,
      buyPrice: price,
      quantity: qty,
      buyDate,
      fee,
    });

    if (!newId) {
      submittingRef.current = false;
      setSubmitting(false);
      setError("資料尚未就緒，請重試儲存。");
      return;
    }
    router.push("/holdings");
    void updateOne(newId);
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-4 sm:p-6" aria-busy={submitting}>
      <fieldset disabled={submitting} className="min-w-0 space-y-5">
        <div className="space-y-2" role="group" aria-labelledby="asset-type-label">
          <p id="asset-type-label" className="text-sm font-medium">資產類型</p>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-raised p-1">
            {ASSET_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={(event) => handleAssetTypeChange(t, event.currentTarget.form)}
                aria-pressed={assetType === t}
                className={`min-h-11 rounded-lg border px-1 py-2 text-sm font-medium transition-colors ${
                  assetType === t
                    ? "border-border bg-surface text-accent"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {getAssetTypeLabel(t)}
              </button>
            ))}
          </div>
        </div>

        {isProperty ? (
          <>
            <Field label="房產名稱或地址" required>
              <input
                value={propertyName}
                onChange={(e) => patchDraft({ propertyName: e.target.value })}
                placeholder="例：台北市大安區…"
                className="input-field"
                required
              />
            </Field>
            <Field label="代號（選填）">
              <input
                value={symbol}
                onChange={(e) => patchDraft({ symbol: e.target.value })}
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
                onChange={(e) => patchDraft({ symbol: e.target.value.toUpperCase() })}
                placeholder={assetType === "stock" ? "2330、00878、00631L" : "18480065"}
                className="input-field font-mono"
                inputMode={assetType === "fund" ? "numeric" : "text"}
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
            </Field>

            <div aria-live="polite">
              <ResolvedInstrumentName assetType={assetType} symbol={symbol} />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label={getBuyPriceLabel(assetType)} required>
            <input
              type="number"
              step="any"
              min="0"
              value={buyPrice}
              onChange={(e) => patchDraft({ buyPrice: e.target.value })}
              className="input-field"
              inputMode="decimal"
              required
            />
          </Field>
          <Field label={getQuantityLabel(assetType)} required>
            <input
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => patchDraft({ quantity: e.target.value })}
              className="input-field"
              inputMode="decimal"
              required
            />
          </Field>
        </div>

        {isProperty && (
          <>
            <Field label="現估總價（選填）">
              <input
                type="number"
                step="any"
                min="0"
                value={currentEstimate}
                onChange={(e) => patchDraft({ currentEstimate: e.target.value })}
                className="input-field"
              />
            </Field>
            <Field label="房貸餘額（選填）">
              <input
                type="number"
                step="any"
                min="0"
                value={mortgageBalance}
                onChange={(e) => patchDraft({ mortgageBalance: e.target.value })}
                className="input-field"
              />
            </Field>
          </>
        )}

        <Field label="買入日期" required>
          <DatePicker
            key={assetType}
            name="buyDate"
            defaultValue={draft.buyDate}
            max={todayIsoDate()}
            required
          />
        </Field>

        {!isProperty && (
          <Field label="買入手續費（選填）">
            <input
              type="number"
              step="any"
              min="0"
              value={buyFee}
              onChange={(e) => patchDraft({ buyFee: e.target.value })}
              placeholder="留空視為 0"
              className="input-field"
            />
          </Field>
        )}

        {isProperty && (
          <p className="text-sm leading-relaxed text-muted">
            現估總價留空時，會使用購入總價。若有填寫房貸餘額，可在貸款頁補上利率與期限。
          </p>
        )}
        {error && <ErrorAlert message={error} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-sm text-muted">
            預估投入成本 <span className="ml-1 font-semibold tabular-nums text-foreground">{canPreview ? formatAmount(cost) : "—"}</span>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
          {!submitting && <Link href="/holdings" className="btn-secondary">取消</Link>}
            <button type="submit" className="btn-primary" disabled={!ready}>{submitting ? "儲存中…" : "儲存持倉"}</button>
          </div>
        </div>
      </fieldset>
      <span className="sr-only" role="status">{submitting ? "正在儲存持倉" : ""}</span>
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
      <span className="font-medium">
        {label}
        {required && <span aria-hidden="true" className="text-rose-700 dark:text-rose-300"> *</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
