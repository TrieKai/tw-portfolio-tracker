"use client";

import type { ReactNode } from "react";
import { formatCurrentMonthZh } from "@/lib/date/iso-date";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { PortfolioPnlBreakdowns } from "@/lib/portfolio/pnl-breakdown";
import { PnlValueWithBreakdown } from "@/components/ui/PnlBreakdownTooltip";
import type { PortfolioSummary as Summary } from "@/lib/types/holding";

export function PortfolioSummaryCards({
  summary,
  pnlBreakdowns,
}: {
  summary: Summary;
  pnlBreakdowns: PortfolioPnlBreakdowns;
}) {
  const unrealizedPositive = summary.totalPnl >= 0;
  const realizedPositive = summary.totalRealizedPnl >= 0;
  const dailyUnrealizedPositive =
    summary.dailyUnrealizedPnl !== null && summary.dailyUnrealizedPnl >= 0;
  const monthlyUnrealizedPositive =
    summary.monthlyUnrealizedPnl !== null && summary.monthlyUnrealizedPnl >= 0;
  const monthlyRealizedPositive = summary.monthlyRealizedPnl >= 0;
  const monthLabel = formatCurrentMonthZh();

  const unrealizedValueClass = unrealizedPositive ? "text-gain" : "text-loss";
  const dailyValueClass =
    summary.dailyUnrealizedPnl !== null
      ? dailyUnrealizedPositive
        ? "text-gain"
        : "text-loss"
      : "text-muted";
  const monthlyValueClass =
    summary.monthlyUnrealizedPnl !== null
      ? monthlyUnrealizedPositive
        ? "text-gain"
        : "text-loss"
      : "text-muted";

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
        value={
          <PnlValueWithBreakdown
            title="未實現損益"
            value={formatCurrency(summary.totalPnl)}
            valueClassName={`text-xl font-semibold sm:text-2xl ${unrealizedValueClass}`}
            breakdown={pnlBreakdowns.totalUnrealized}
          />
        }
        highlight={unrealizedPositive ? "gain" : "loss"}
        valueIsNode
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
          <PnlValueWithBreakdown
            title="日未實現"
            value={
              summary.dailyUnrealizedPnl !== null
                ? formatCurrency(summary.dailyUnrealizedPnl)
                : "—"
            }
            valueClassName={`text-xl font-semibold sm:text-2xl ${dailyValueClass}`}
            periodBreakdown={pnlBreakdowns.dailyUnrealized}
          />
        }
        sub={
          summary.dailyUnrealizedPnl !== null
            ? "今日 · 相對前交易日"
            : summary.hasStaleFundNavOnDaily
              ? "今日 · 基金淨值非今日"
              : "今日 · 請更新行情"
        }
        subWarn={
          summary.dailyUnrealizedPnl !== null && summary.hasStaleFundNavOnDaily
            ? "基金淨值非今日"
            : undefined
        }
        highlight={
          summary.dailyUnrealizedPnl !== null
            ? dailyUnrealizedPositive
              ? "gain"
              : "loss"
            : undefined
        }
        valueIsNode
      />
      <StatCard
        label="月未實現"
        value={
          <PnlValueWithBreakdown
            title="月未實現"
            value={
              summary.monthlyUnrealizedPnl !== null
                ? formatCurrency(summary.monthlyUnrealizedPnl)
                : "—"
            }
            valueClassName={`text-xl font-semibold sm:text-2xl ${monthlyValueClass}`}
            periodBreakdown={pnlBreakdowns.monthlyUnrealized}
          />
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
        valueIsNode
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
  subWarn,
  muted,
  highlight,
  valueIsNode,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  subWarn?: string;
  muted?: boolean;
  highlight?: "gain" | "loss";
  valueIsNode?: boolean;
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
      {valueIsNode ? (
        <div className="mt-1">{value}</div>
      ) : (
        <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${valueClass}`}>
          {value}
        </p>
      )}
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      {subWarn && (
        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
          {subWarn}
        </p>
      )}
    </div>
  );
}
