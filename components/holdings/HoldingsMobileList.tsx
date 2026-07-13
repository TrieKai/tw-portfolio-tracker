"use client";

import { useState } from "react";
import {
  formatCurrency,
  formatPercent,
  formatQuotePrice,
} from "@/lib/portfolio/calculations";
import { getAssetTypeLabel, supportsAutoPriceUpdate } from "@/lib/portfolio/asset-labels";
import type { HoldingGroupWithMetrics } from "@/lib/portfolio/holding-groups";
import { HoldingLotDetailPanel } from "./HoldingLotActions";

export function HoldingsMobileList({
  groups,
  updatingId,
  onRefresh,
  onEdit,
  onSell,
  onSellGroup,
  onManual,
  onRemove,
  onRefreshGroup,
}: {
  groups: HoldingGroupWithMetrics[];
  updatingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onSell: (id: string) => void;
  onSellGroup: (groupKey: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
  onRefreshGroup: (group: HoldingGroupWithMetrics) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpanded(groupKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  const groupUpdating = (g: HoldingGroupWithMetrics) =>
    g.lots.some((l) => updatingId === l.id);

  return (
    <ul className="space-y-3 md:hidden">
      {groups.map((g) => {
        const isOpen = g.isMerged && expanded.has(g.groupKey);
        const pnlClass = g.pnl >= 0 ? "text-gain" : "text-loss";

        return (
          <li key={g.groupKey} className="glass-card space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.name}</p>
                <p className="font-mono text-xs text-muted">
                  {g.symbol}
                  {g.market ? ` · ${g.market.toUpperCase()}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {getAssetTypeLabel(g.assetType)}
                  {g.isMerged
                    ? ` · ${g.lots.length} 筆 · 均價 ${formatQuotePrice(g.avgBuyPrice, g.assetType)}`
                    : ` · 買入 ${g.lots[0].buyDate}`}
                </p>
                {!g.isMerged && (
                  <p className="text-xs text-muted tabular-nums">
                    買入價 {formatQuotePrice(g.lots[0].buyPrice, g.assetType)} · 數量{" "}
                    {g.quantity}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-muted">市值</p>
                <p className="font-semibold tabular-nums">
                  {formatCurrency(g.marketValue)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted">現價</p>
                <p className="tabular-nums">
                  {g.hasLivePrice
                    ? formatQuotePrice(g.currentPrice!, g.assetType)
                    : "—"}
                </p>
                {g.priceDate && (
                  <p className="text-xs text-muted">{g.priceDate}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted">損益</p>
                <p className={`tabular-nums font-medium ${pnlClass}`}>
                  {g.hasLivePrice ? formatCurrency(g.pnl) : "—"}
                </p>
                <p className={`text-xs tabular-nums ${pnlClass}`}>
                  {g.hasLivePrice ? formatPercent(g.returnRate) : "—"}
                </p>
              </div>
            </div>

            {g.isMerged && (
              <p className="text-xs text-muted tabular-nums">
                合計數量 {g.quantity} · 總成本 {formatCurrency(g.costBasis)}
              </p>
            )}

            {g.lastError && (
              <p className="text-xs text-rose-500">{g.lastError}</p>
            )}

            {isOpen && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                {g.lots.map((lot) => (
                  <HoldingLotDetailPanel
                    key={lot.id}
                    lot={lot}
                    updatingId={updatingId}
                    onRefresh={onRefresh}
                    onEdit={onEdit}
                    onSell={onSell}
                    onManual={onManual}
                    onRemove={onRemove}
                    compact
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
              {g.isMerged ? (
                <>
                  {g.lots.some((l) => supportsAutoPriceUpdate(l.assetType)) && (
                    <button
                      type="button"
                      disabled={groupUpdating(g)}
                      onClick={() => onRefreshGroup(g)}
                      className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                    >
                      {groupUpdating(g) ? "…" : "全部更新"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSellGroup(g.groupKey)}
                    className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                  >
                    賣出
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(g.groupKey)}
                    className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                  >
                    {isOpen ? "收合明細" : "展開明細"}
                  </button>
                </>
              ) : (
                <>
                  {supportsAutoPriceUpdate(g.lots[0].assetType) && (
                    <button
                      type="button"
                      disabled={updatingId === g.lots[0].id}
                      onClick={() => onRefresh(g.lots[0].id)}
                      className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                    >
                      {updatingId === g.lots[0].id ? "…" : "更新"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onEdit(g.lots[0].id)}
                    className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => onSell(g.lots[0].id)}
                    className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                  >
                    賣出
                  </button>
                  <button
                    type="button"
                    onClick={() => onManual(g.lots[0].id)}
                    className="btn-secondary flex-1 text-xs sm:flex-none touch-target"
                  >
                    {g.lots[0].assetType === "property" ? "估價" : "手動"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(g.lots[0].id)}
                    className="flex-1 px-2 py-2 text-xs text-rose-500 sm:flex-none touch-target"
                  >
                    刪除
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
