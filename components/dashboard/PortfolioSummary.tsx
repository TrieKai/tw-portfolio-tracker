"use client";

import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { PortfolioSummary as Summary } from "@/lib/types/holding";

export function PortfolioSummaryCards({ summary }: { summary: Summary }) {
  const pnlPositive = summary.totalPnl >= 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="總資產" value={formatCurrency(summary.totalValue)} />
      <StatCard
        label="總成本"
        value={formatCurrency(summary.totalCost)}
        muted
      />
      <StatCard
        label="總損益"
        value={formatCurrency(summary.totalPnl)}
        highlight={pnlPositive ? "gain" : "loss"}
      />
      <StatCard
        label="總報酬率"
        value={formatPercent(summary.totalReturnRate)}
        highlight={pnlPositive ? "gain" : "loss"}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  muted,
  highlight,
}: {
  label: string;
  value: string;
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
    </div>
  );
}
