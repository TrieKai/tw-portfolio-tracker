"use client";

import { formatCurrentMonthZh } from "@/lib/date/iso-date";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { PortfolioSummary as Summary } from "@/lib/types/holding";

export function PortfolioSummaryCards({ summary }: { summary: Summary }) {
  const unrealizedPositive = summary.totalPnl >= 0;
  const realizedPositive = summary.totalRealizedPnl >= 0;
  const dailyUnrealizedPositive =
    summary.dailyUnrealizedPnl !== null && summary.dailyUnrealizedPnl >= 0;
  const monthlyUnrealizedPositive =
    summary.monthlyUnrealizedPnl !== null && summary.monthlyUnrealizedPnl >= 0;
  const monthlyRealizedPositive = summary.monthlyRealizedPnl >= 0;
  const monthLabel = formatCurrentMonthZh();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4">
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
      <StatCard
        label="日未實現"
        value={
          summary.dailyUnrealizedPnl !== null
            ? formatCurrency(summary.dailyUnrealizedPnl)
            : "—"
        }
        sub={
          summary.dailyUnrealizedPnl !== null
            ? "今日 · 相對前交易日"
            : "今日 · 請更新行情"
        }
        highlight={
          summary.dailyUnrealizedPnl !== null
            ? dailyUnrealizedPositive
              ? "gain"
              : "loss"
            : undefined
        }
      />
      <StatCard
        label="月未實現"
        value={
          summary.monthlyUnrealizedPnl !== null
            ? formatCurrency(summary.monthlyUnrealizedPnl)
            : "—"
        }
        sub={
          summary.monthlyUnrealizedPnl !== null
            ? `${monthLabel} · 相對月初`
            : `${monthLabel} · 請載入價格歷史`
        }
        highlight={
          summary.monthlyUnrealizedPnl !== null
            ? monthlyUnrealizedPositive
              ? "gain"
              : "loss"
            : undefined
        }
      />
      <StatCard
        label="月已實現"
        value={formatCurrency(summary.monthlyRealizedPnl)}
        sub={
          summary.monthlySaleCount > 0
            ? `${monthLabel} · ${summary.monthlySaleCount} 筆賣出`
            : `${monthLabel} · 本月尚無賣出`
        }
        highlight={monthlyRealizedPositive ? "gain" : "loss"}
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
