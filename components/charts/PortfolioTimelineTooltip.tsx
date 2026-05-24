"use client";

import { formatCurrency, formatPercent } from "@/lib/portfolio/calculations";
import type { PortfolioTimelinePoint } from "@/lib/portfolio/portfolio-timeline";

export function PortfolioTimelineTooltip({
  point,
}: {
  point: PortfolioTimelinePoint;
}) {
  return (
    <div className="max-w-xs space-y-2 text-xs">
      <p className="font-medium">{point.date}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-muted">總市值</span>
        <span className="text-right tabular-nums">
          {formatCurrency(point.totalValue)}
        </span>
        <span className="text-muted">投入成本</span>
        <span className="text-right tabular-nums">
          {formatCurrency(point.totalCost)}
        </span>
        <span className="text-muted">損益</span>
        <span
          className={`text-right tabular-nums ${
            point.pnl >= 0 ? "text-gain" : "text-loss"
          }`}
        >
          {formatCurrency(point.pnl)} ({formatPercent(point.returnRate)})
        </span>
      </div>

      {point.costAddedToday > 0 && (
        <p className="rounded bg-accent-dim px-2 py-1 text-accent">
          當日新投入 {formatCurrency(point.costAddedToday)}：
          {point.newHoldings.join("、")}
        </p>
      )}

      <div className="border-t border-border pt-2">
        <p className="mb-1 text-muted">各筆持倉（買入價 → 當日市值）</p>
        <ul className="max-h-40 space-y-1.5 overflow-y-auto">
          {point.holdings.map((h) => (
            <li key={h.holdingId} className="leading-snug">
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {h.name}
                  {h.isBuyDate && (
                    <span className="ml-1 text-accent">· 建倉</span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatCurrency(h.marketValue)}
                </span>
              </div>
              <div className="text-muted">
                買入 {h.buyDate} · {formatCurrency(h.buyPrice)} ×{" "}
                {h.quantity}
                {!h.hasMarketPrice && " · 以買入價估算"}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
