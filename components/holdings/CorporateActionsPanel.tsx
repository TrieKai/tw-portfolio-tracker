"use client";

import { useMemo } from "react";
import {
  corporateActionLabel,
} from "@/lib/client/corporate-actions-api";
import {
  formatCurrency,
  formatQuotePrice,
} from "@/lib/portfolio/calculations";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";
import { usePortfolio } from "@/providers/PortfolioProvider";

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${(value * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
}

function eventDescription(event: CorporateActionEvent): string {
  const parts: string[] = [];
  if (event.stockDividendRatio > 0) {
    parts.push(`股票股利 ${formatRatio(event.stockDividendRatio)}`);
  }
  if (event.cashDividend !== undefined && event.cashDividend > 0) {
    parts.push(`現金股利 ${formatCurrency(event.cashDividend)}/股`);
  }
  if (event.subscriptionRatio > 0) {
    const price =
      event.subscriptionPrice !== undefined
        ? `，認購價 ${formatQuotePrice(event.subscriptionPrice, "stock")}`
        : "";
    parts.push(`現金增資配股率 ${formatRatio(event.subscriptionRatio)}${price}`);
  }
  return parts.join(" · ") || event.exDividendLabel || "公司行動";
}

export function CorporateActionsPanel() {
  const {
    holdings,
    corporateActionStatus,
    corporateActionMessage,
    pendingCorporateActions,
    scanCorporateActions,
    applyDetectedCorporateAction,
    storage,
  } = usePortfolio();

  const lotsById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding])),
    [holdings]
  );

  const handledCount = storage.corporateActions.length;
  const loading = corporateActionStatus === "loading";

  return (
    <section className="glass-card space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">公司行動</h2>
          <p className="text-sm text-muted">
            掃描 TWSE / TPEx 除權息資料，股票股利可直接調整股數與成本。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scanCorporateActions()}
          disabled={loading}
          className="btn-secondary w-full sm:w-auto"
        >
          {loading ? "掃描中…" : "掃描除權息"}
        </button>
      </div>

      {corporateActionMessage && (
        <p
          className={
            corporateActionStatus === "error"
              ? "text-sm text-rose-500"
              : "text-sm text-muted"
          }
        >
          {corporateActionMessage}
        </p>
      )}

      {pendingCorporateActions.length > 0 ? (
        <ul className="space-y-3">
          {pendingCorporateActions.map((event) => {
            const lot = lotsById.get(event.holdingId);
            const canApply = event.stockDividendRatio > 0;

            return (
              <li
                key={`${event.holdingId}:${event.id}`}
                className="rounded-lg border border-border/80 bg-surface px-3 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {event.name}（{event.symbol}） ·{" "}
                      {corporateActionLabel(event)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {event.effectiveDate} · {eventDescription(event)}
                    </p>
                    {lot && (
                      <p className="mt-1 text-xs text-muted tabular-nums">
                        買入 {lot.buyDate} · 現有 {lot.quantity} 股 · 均價{" "}
                        {formatQuotePrice(lot.buyPrice, "stock")}
                      </p>
                    )}
                    {event.note && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                        {event.note}
                      </p>
                    )}
                    {!canApply && (
                      <p className="mt-1 text-xs text-muted">
                        此事件目前僅記錄處理，不會改變股數與成本。
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => applyDetectedCorporateAction(event)}
                    className={canApply ? "btn-primary text-sm" : "btn-secondary text-sm"}
                  >
                    {canApply ? "套用調整" : "標記已處理"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          尚無待處理事件
          {handledCount > 0 ? `，已處理 ${handledCount} 筆。` : "。"}
        </p>
      )}
    </section>
  );
}
