"use client";

import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { PortfolioSummary as Summary } from "@/lib/types/holding";

export function PortfolioSummaryCards({ summary }: { summary: Summary }) {
  const unrealizedPositive = summary.totalPnl >= 0;
  const realizedPositive = summary.totalRealizedPnl >= 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard label="總資產" value={formatCurrency(summary.totalValue)} />
      <StatCard
        label="總成本"
        value={formatCurrency(summary.totalCost)}
        muted
      />
      <StatCard
        label="未實現損益"
        value={formatCurrency(summary.totalPnl)}
        highlight={unrealizedPositive ? "gain" : "loss"}
      />
      <StatCard
        label="已實現損益"
        value={formatCurrency(summary.totalRealizedPnl)}
        sub={
          summary.saleCount > 0
            ? `${summary.saleCount} 筆賣出`
            : "尚無賣出紀錄"
        }
        highlight={realizedPositive ? "gain" : "loss"}
      />
      <StatCard
        label="未實現報酬率"
        value={formatPercent(summary.totalReturnRate)}
        highlight={unrealizedPositive ? "gain" : "loss"}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  highlight?: "gain" | "loss";
}) {
  const valueClass = highlight
    ? highlight === "gain"
      ? "text-gain"
      : "text-loss"
    : muted
      ? "text-muted"
      : "text-foreground";

  return (
    <div className="glass-card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${valueClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
