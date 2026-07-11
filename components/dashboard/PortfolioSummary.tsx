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
import type { DashboardCardView } from "@/lib/types/ui-preferences";

export function PortfolioSummaryCards({
  summary,
  pnlBreakdowns,
  view = "standard",
  asOfDate,
}: {
  summary: Summary;
  pnlBreakdowns: PortfolioPnlBreakdowns;
  view?: DashboardCardView;
  asOfDate?: string;
}) {
  const unrealizedPositive = summary.totalPnl >= 0;
  const realizedPositive = summary.totalRealizedPnl >= 0;
  const dailyUnrealizedPositive =
    summary.dailyUnrealizedPnl !== null && summary.dailyUnrealizedPnl >= 0;
  const monthlyUnrealizedPositive =
    summary.monthlyUnrealizedPnl !== null && summary.monthlyUnrealizedPnl >= 0;
  const monthlyRealizedPositive = summary.monthlyRealizedPnl >= 0;
  const monthLabel = asOfDate
    ? `${Number(asOfDate.slice(5, 7))} 月`
    : formatCurrentMonthZh();
  const dailyPeriod = summary.dailyValuationStartDate && summary.dailyValuationEndDate
    ? `${shortDate(summary.dailyValuationEndDate)} · 相對 ${shortDate(summary.dailyValuationStartDate)}`
    : null;

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

  if (view === "compact") {
    return (
      <div className="glass-card grid gap-4 p-5 sm:grid-cols-4">
        <MiniStat label="總資產" value={formatCurrency(summary.totalValue)} />
        <MiniStat label="總成本" value={formatCurrency(summary.totalCost)} />
        <MiniStat label="未實現" value={formatCurrency(summary.totalPnl)} highlight={unrealizedPositive ? "gain" : "loss"} />
        <MiniStat label="報酬率" value={formatPercent(summary.totalReturnRate)} highlight={unrealizedPositive ? "gain" : "loss"} />
      </div>
    );
  }

  if (view === "visual") {
    const progress = summary.totalCost > 0
      ? Math.min(100, Math.max(0, (summary.totalValue / summary.totalCost) * 50))
      : 0;
    return (
      <div className="glass-card grid gap-5 p-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:items-center">
        <div>
          <p className="text-sm text-muted">資產淨值</p>
          <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{formatCurrency(summary.totalValue)}</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-raised">
            <div className={`h-full rounded-full ${unrealizedPositive ? "bg-gain" : "bg-loss"}`} style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">相對投入成本的資產進度</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="未實現" value={formatCurrency(summary.totalPnl)} highlight={unrealizedPositive ? "gain" : "loss"} />
          <MiniStat label="報酬率" value={formatPercent(summary.totalReturnRate)} highlight={unrealizedPositive ? "gain" : "loss"} />
        </div>
      </div>
    );
  }

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
            ? dailyPeriod ?? "最近兩個估值日"
            : summary.hasStaleFundNavOnDaily
              ? "請累積價格歷史 · 基金淨值非今日"
              : "請累積至少兩個估值日"
        }
        subWarn={
          summary.dailyUnrealizedPnl !== null
            ? summary.dailyValuationUsesPreviousDate
              ? "今日可能休市或行情尚未更新"
              : summary.hasStaleFundNavOnDaily
                ? "部分基金淨值非今日"
                : undefined
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

function shortDate(date: string): string {
  return date.slice(5).replace("-", "/");
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: "gain" | "loss" }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-raised/70 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 truncate font-semibold tabular-nums ${highlight === "gain" ? "text-gain" : highlight === "loss" ? "text-loss" : "text-foreground"}`}>{value}</p>
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
