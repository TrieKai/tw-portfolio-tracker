"use client";

import Link from "next/link";
import { CorporateActionsPanel } from "@/components/holdings/CorporateActionsPanel";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { SaleHistoryTable } from "@/components/holdings/SaleHistoryTable";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { PortfolioDataPanel } from "@/components/portfolio/PortfolioDataPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { AmountVisibilityToggle } from "@/components/ui/AmountVisibilityToggle";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function HoldingsPage() {
  const { ready, holdings, sales, storage, latestAddedHoldingId, dismissAddedHolding } = usePortfolio();

  if (!ready) return <LoadingSpinner />;
  const added = holdings.find((holding) => holding.id === latestAddedHoldingId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="持倉列表"
        action={
          <div className="flex flex-wrap gap-2">
            <AmountVisibilityToggle />
            <Link href="/holdings/new" className="btn-primary flex-1 sm:flex-none">
              新增持倉
            </Link>
          </div>
        }
      />
      {added && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <div role="status">
            <p className="text-sm font-medium">已儲存 {added.name}</p>
            {added.assetType !== "property" && (
              <p className="mt-1 text-sm text-muted">
                {added.hasLivePrice
                  ? "現價已更新。"
                  : added.lastError
                    ? "現價尚未更新，可在該筆持倉重試，或在更多操作中手動輸入。"
                    : "正在取得現價…"}
              </p>
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={dismissAddedHolding}>關閉提示</button>
        </div>
      )}
      <HoldingsTable holdings={holdings} />
      <CorporateActionsPanel />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">月度損益</h2>
        <MonthlyPnlTable storage={storage} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">已實現損益 · 賣出紀錄</h2>
        <SaleHistoryTable sales={sales} />
      </section>

      <div id="portfolio-backup"><PortfolioDataPanel /></div>
    </div>
  );
}
