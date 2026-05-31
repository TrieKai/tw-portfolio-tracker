"use client";

import Link from "next/link";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { SaleHistoryTable } from "@/components/holdings/SaleHistoryTable";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { PortfolioDataPanel } from "@/components/portfolio/PortfolioDataPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function HoldingsPage() {
  const { ready, holdings, sales, storage } = usePortfolio();

  if (!ready) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="持倉列表"
        action={
          <Link href="/holdings/new" className="btn-primary w-full sm:w-auto touch-target">
            新增持倉
          </Link>
        }
      />
      <HoldingsTable holdings={holdings} />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">月度損益</h2>
        <MonthlyPnlTable
          holdings={storage.holdings}
          priceHistory={storage.priceHistory}
          sales={sales}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">已實現損益 · 賣出紀錄</h2>
        <SaleHistoryTable sales={sales} />
      </section>

      <PortfolioDataPanel />
    </div>
  );
}
