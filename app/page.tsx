"use client";

import Link from "next/link";
import { AssetAllocationChart } from "@/components/dashboard/AssetAllocationChart";
import { PortfolioSummaryCards } from "@/components/dashboard/PortfolioSummary";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function DashboardPage() {
  const { ready, holdings, summary, storage } = usePortfolio();

  if (!ready) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">投資總覽</h1>
          <p className="mt-1 text-sm text-muted">
            台股與境內基金持倉 · 本機儲存
          </p>
        </div>
        <Link href="/holdings/new" className="btn-primary">
          新增持倉
        </Link>
      </div>

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
          </ul>
        </div>
      </div>

      <section className="glass-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">資產趨勢（今年度）</h2>
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
