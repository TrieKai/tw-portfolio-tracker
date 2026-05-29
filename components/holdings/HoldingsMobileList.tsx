"use client";

import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { HoldingWithMetrics } from "@/lib/types/holding";

export function HoldingsMobileList({
  holdings,
  updatingId,
  onRefresh,
  onEdit,
  onManual,
  onRemove,
}: {
  holdings: HoldingWithMetrics[];
  updatingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="space-y-3 md:hidden">
      {holdings.map((h) => (
        <li
          key={h.id}
          className="glass-card space-y-3 p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{h.name}</p>
              <p className="font-mono text-xs text-muted">
                {h.symbol}
                {h.market ? ` · ${h.market.toUpperCase()}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {h.assetType === "stock" ? "台股" : "基金"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">市值</p>
              <p className="font-semibold tabular-nums">
                {formatCurrency(h.marketValue)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted">現價</p>
              <p className="tabular-nums">
                {h.hasLivePrice ? formatCurrency(h.currentPrice!) : "—"}
              </p>
              {h.priceDate && (
                <p className="text-xs text-muted">{h.priceDate}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted">損益</p>
              <p
                className={`tabular-nums font-medium ${
                  h.pnl >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {h.hasLivePrice ? formatCurrency(h.pnl) : "—"}
              </p>
              <p
                className={`text-xs tabular-nums ${
                  h.returnRate >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {h.hasLivePrice ? formatPercent(h.returnRate) : "—"}
              </p>
            </div>
          </div>

          {h.lastError && (
            <p className="text-xs text-rose-500">{h.lastError}</p>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            <button
              type="button"
              disabled={updatingId === h.id}
              onClick={() => onRefresh(h.id)}
              className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
            >
              {updatingId === h.id ? "…" : "更新"}
            </button>
            <button
              type="button"
              onClick={() => onEdit(h.id)}
              className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
            >
              編輯
            </button>
            <button
              type="button"
              onClick={() => onManual(h.id)}
              className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
            >
              手動
            </button>
            <button
              type="button"
              onClick={() => onRemove(h.id)}
              className="flex-1 px-2 py-2 text-xs text-rose-500 sm:flex-none touch-target"
            >
              刪除
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
