"use client";

import {
  formatCurrency,
  formatPercent,
  formatQuotePrice,
} from "@/lib/portfolio/calculations";
import {
  supportsAutoPriceUpdate,
} from "@/lib/portfolio/asset-labels";
import type { HoldingWithMetrics } from "@/lib/types/holding";

/** 單筆買入明細（展開列）：買入資訊 + 操作按鈕 */
export function HoldingLotDetailPanel({
  lot,
  updatingId,
  onRefresh,
  onEdit,
  onSell,
  onManual,
  onRemove,
  compact,
}: {
  lot: HoldingWithMetrics;
  updatingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onSell: (id: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  const lotPnlClass =
    lot.hasLivePrice && lot.pnl >= 0 ? "text-gain" : "text-loss";

  return (
    <div
      className={
        compact
          ? "rounded-lg border border-border/80 bg-surface px-3 py-3 text-sm"
          : "flex flex-wrap items-center justify-between gap-3 border-t border-border/40 py-2 first:border-t-0"
      }
    >
      <dl
        className={
          compact
            ? "grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4"
            : "grid min-w-[200px] flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4"
        }
      >
        <div>
          <dt className="text-muted">買入日</dt>
          <dd className="tabular-nums">{lot.buyDate}</dd>
        </div>
        <div>
          <dt className="text-muted">買入價</dt>
          <dd className="tabular-nums">
            {formatQuotePrice(lot.buyPrice, lot.assetType)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">數量</dt>
          <dd className="tabular-nums">{lot.quantity}</dd>
        </div>
        <div>
          <dt className="text-muted">投入 / 損益</dt>
          <dd className="tabular-nums">
            {formatCurrency(lot.costBasis)}
            {lot.hasLivePrice && (
              <span className={`ml-1 ${lotPnlClass}`}>
                ({formatCurrency(lot.pnl)})
              </span>
            )}
          </dd>
        </div>
        {!compact && lot.hasLivePrice && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-muted sr-only">報酬率</dt>
            <dd className={`tabular-nums ${lotPnlClass}`}>
              {formatPercent(lot.returnRate)}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-1">
        {supportsAutoPriceUpdate(lot.assetType) && (
          <button
            type="button"
            disabled={updatingId === lot.id}
            onClick={() => onRefresh(lot.id)}
            className="btn-secondary text-xs py-1 px-2"
          >
            {updatingId === lot.id ? "…" : "更新"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(lot.id)}
          className="btn-secondary text-xs py-1 px-2"
        >
          編輯
        </button>
        <button
          type="button"
          onClick={() => onSell(lot.id)}
          className="btn-secondary text-xs py-1 px-2"
        >
          賣出
        </button>
        <button
          type="button"
          onClick={() => onManual(lot.id)}
          className="btn-secondary text-xs py-1 px-2"
        >
          {lot.assetType === "property" ? "估價" : "手動"}
        </button>
        <button
          type="button"
          onClick={() => onRemove(lot.id)}
          className="text-xs text-rose-500 hover:underline px-2"
        >
          刪除
        </button>
      </div>
    </div>
  );
}
