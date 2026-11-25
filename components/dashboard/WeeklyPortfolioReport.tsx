"use client";

import { useMemo } from "react";
import { formatIsoDateZh } from "@/lib/date/iso-date";
import { getAssetTypeLabel } from "@/lib/portfolio/asset-labels";
import type { PortfolioHistory } from "@/lib/portfolio/time-travel";
import { buildWeeklyPortfolioReport } from "@/lib/portfolio/weekly-report";
import type { PortfolioStorage } from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

export function WeeklyPortfolioReport({
  storage,
  portfolioHistory,
  asOfDate,
  view = "standard",
}: {
  storage: PortfolioStorage;
  portfolioHistory: PortfolioHistory;
  asOfDate: string;
  view?: DashboardCardView;
}) {
  const { formatAmount } = useAmountPrivacy();
  const report = useMemo(
    () => buildWeeklyPortfolioReport(storage, asOfDate, portfolioHistory),
    [storage, asOfDate, portfolioHistory]
  );

  if (!report) {
    return (
      <article className="glass-card p-5 sm:p-6">
        <h2 className="text-xl font-semibold">每週投資週報</h2>
        <p className="mt-3 text-sm text-muted">至少需要兩個估值或交易日期，才能比較期初與期末持倉。</p>
      </article>
    );
  }

  const period = `${formatIsoDateZh(report.startDate)}－${formatIsoDateZh(report.endDate)}`;
  const drift = report.largestAllocationDrift;
  const { topPositive, topNegative } = report;

  return (
    <article className="weekly-report glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">每週投資週報</h2>
          <p className="mt-1 text-xs text-muted">{period}</p>
        </div>
        {report.usesPreviousDate && (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">截至最近資料日</span>
        )}
      </div>

      <dl className="weekly-metrics mt-4 grid gap-3" data-compact={view === "compact"}>
        {view !== "compact" && <Metric label="期初持倉市值" value={formatAmount(report.startValue)} />}
        <Metric label="期末持倉市值" value={formatAmount(report.endValue)} />
        {view !== "compact" && <Metric label="持倉市值變化" value={formatAmount(report.valueChange)} />}
        <Metric label="未實現損益變化" value={formatAmount(report.unrealizedChange)} tone={changeTone(report.unrealizedChange)} />
        <Metric label="期間已實現損益" value={formatAmount(report.realizedPnl)} tone={changeTone(report.realizedPnl)} />
        <Metric label="期間買入金額" value={formatAmount(report.newCapital)} />
      </dl>

      {view !== "compact" && (topPositive || topNegative) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {topPositive && <Insight
            label="未實現損益增加最多"
            text={`${topPositive.name} ${formatAmount(topPositive.amount)}`}
            tone="gain"
          />}
          {topNegative && <Insight
            label="未實現損益減少最多"
            text={`${topNegative.name} ${formatAmount(topNegative.amount)}`}
            tone="loss"
          />}
        </div>
      )}

      {drift && Math.abs(drift.difference) >= 1 && (
        <p className="mt-4 text-xs text-muted">
          配置提醒：{getAssetTypeLabel(drift.assetType)}目前 {drift.currentPercent.toFixed(1)}%，較目標{drift.difference > 0 ? "高" : "低"} {Math.abs(drift.difference).toFixed(1)} 個百分點。
        </p>
      )}
      <p className="mt-3 text-xs text-muted">按各日實際持倉估值。缺少當日行情時會沿用最近可用價格，或按買入價估算。</p>
    </article>
  );
}

function changeTone(amount: number): "gain" | "loss" | undefined {
  return amount > 0 ? "gain" : amount < 0 ? "loss" : undefined;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl bg-surface-raised/60 p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-semibold tabular-nums ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}>{value}</dd>
    </div>
  );
}

function Insight({ label, text, tone }: { label: string; text: string; tone: "gain" | "loss" }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-1 text-sm font-medium ${tone === "gain" ? "text-gain" : "text-loss"}`}>{text}</p>
    </div>
  );
}
