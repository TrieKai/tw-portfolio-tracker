"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetAllocationChart } from "@/components/dashboard/AssetAllocationChart";
import { PortfolioSummaryCards } from "@/components/dashboard/PortfolioSummary";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { formatCurrentMonthZh } from "@/lib/date/iso-date";
import { formatCurrency } from "@/lib/portfolio/calculations";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function DashboardPage() {
  const { ready, holdings, summary, storage, sales } = usePortfolio();

  if (!ready) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="投資總覽"
        description="台股與境內基金持倉 · 本機儲存"
        action={
          <Link href="/holdings/new" className="btn-primary w-full sm:w-auto touch-target">
            新增持倉
          </Link>
        }
      />

      <PortfolioSummaryCards summary={summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AssetAllocationChart summary={summary} />
        <div className="glass-card p-5">
          <h2 className="mb-3 text-sm font-medium text-muted">快速統計</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted">持倉筆數</span>
              <span>{summary.holdingCount}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">股票市值</span>
              <span>{summary.stockValue.toLocaleString("zh-TW")} 元</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">基金市值</span>
              <span>{summary.fundValue.toLocaleString("zh-TW")} 元</span>
            </li>
            <li className="flex justify-between border-t border-border/60 pt-2">
              <span className="text-muted">月未實現（{formatCurrentMonthZh()}）</span>
              <span
                className={
                  summary.monthlyUnrealizedPnl === null
                    ? "text-muted"
                    : summary.monthlyUnrealizedPnl >= 0
                      ? "text-gain"
                      : "text-loss"
                }
              >
                {summary.monthlyUnrealizedPnl !== null
                  ? formatCurrency(summary.monthlyUnrealizedPnl)
                  : "—"}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">月已實現（{formatCurrentMonthZh()}）</span>
              <span
                className={
                  summary.monthlyRealizedPnl >= 0 ? "text-gain" : "text-loss"
                }
              >
                {formatCurrency(summary.monthlyRealizedPnl)}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">累計已實現</span>
              <span
                className={
                  summary.totalRealizedPnl >= 0 ? "text-gain" : "text-loss"
                }
              >
                {summary.totalRealizedPnl.toLocaleString("zh-TW")} 元
              </span>
            </li>
          </ul>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">月度損益</h2>
        <MonthlyPnlTable
          holdings={storage.holdings}
          priceHistory={storage.priceHistory}
          sales={sales}
        />
      </section>

      <section className="glass-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold sm:text-lg">資產趨勢（今年度）</h2>
          <Link href="/trends" className="text-sm text-accent hover:underline">
            查看完整趨勢 →
          </Link>
        </div>
        <PortfolioValueTrendChart
          holdings={holdings}
          priceHistory={storage.priceHistory}
          range="ytd"
        />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">持倉摘要</h2>
        <HoldingsTable holdings={holdings} />
      </section>
    </div>
  );
}
