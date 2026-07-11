"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetAllocationChart } from "@/components/dashboard/AssetAllocationChart";
import { ExposurePanel } from "@/components/dashboard/ExposurePanel";
import { TimeTravelBar } from "@/components/dashboard/TimeTravelBar";
import { PortfolioSummaryCards } from "@/components/dashboard/PortfolioSummary";
import { PortfolioInsights } from "@/components/dashboard/PortfolioInsights";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { formatCurrentMonthZh } from "@/lib/date/iso-date";
import {
  computePortfolioSummary,
  enrichHoldings,
  formatCurrency,
} from "@/lib/portfolio/calculations";
import { computePortfolioExposure } from "@/lib/portfolio/exposure";
import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { buildPortfolioPnlBreakdowns } from "@/lib/portfolio/pnl-breakdown";
import { computePortfolioHealth } from "@/lib/portfolio/health";
import { computeInvestmentWeather } from "@/lib/portfolio/weather";
import { todayIsoDate } from "@/lib/date/iso-date";
import {
  buildHoldingsSnapshot,
  getPortfolioHistoryDates,
  trimPriceHistoryAtDate,
} from "@/lib/portfolio/time-travel";
import { PnlValueWithBreakdown } from "@/components/ui/PnlBreakdownTooltip";
import type { DashboardSectionId } from "@/lib/types/ui-preferences";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";

export default function DashboardPage() {
  const { ready, holdings, summary, exposure, pnlBreakdowns, storage, sales, setExposureSettings } = usePortfolio();
  const { preferences } = useUiPreferences();
  const [travelDate, setTravelDate] = useState<string | null>(null);

  const historyDates = useMemo(
    () => getPortfolioHistoryDates(storage.holdings, storage.priceHistory),
    [storage.holdings, storage.priceHistory]
  );
  const travelState = useMemo(() => {
    if (!travelDate) return null;
    const rawHoldings = buildHoldingsSnapshot(
      storage.holdings,
      storage.priceHistory,
      travelDate
    );
    const history = trimPriceHistoryAtDate(storage.priceHistory, travelDate);
    const enriched = enrichHoldings(rawHoldings);
    const visibleSales = sales.filter((sale) => sale.sellDate <= travelDate);
    return {
      rawHoldings,
      history,
      holdings: enriched,
      sales: visibleSales,
      summary: computePortfolioSummary(enriched, visibleSales, {
        holdingsForTimeline: rawHoldings,
        priceHistory: history,
        asOfDate: travelDate,
      }),
      exposure: computePortfolioExposure(enriched, {
        liabilities: storage.settings.liabilities,
      }),
      pnlBreakdowns: buildPortfolioPnlBreakdowns(enriched, history, travelDate),
    };
  }, [sales, storage.holdings, storage.priceHistory, storage.settings.liabilities, travelDate]);

  if (!ready) {
    return <LoadingSpinner />;
  }

  const shownHoldings = travelState?.holdings ?? holdings;
  const shownRawHoldings = travelState?.rawHoldings ?? storage.holdings;
  const shownHistory = travelState?.history ?? storage.priceHistory;
  const shownSales = travelState?.sales ?? sales;
  const shownSummary = travelState?.summary ?? summary;
  const shownExposure = travelState?.exposure ?? exposure;
  const shownBreakdowns = travelState?.pnlBreakdowns ?? pnlBreakdowns;
  const viewFor = (section: DashboardSectionId) =>
    preferences.dashboardLayout.find((item) => item.section === section)?.view ??
    "standard";
  const shownMonthLabel = travelDate
    ? `${Number(travelDate.slice(5, 7))} 月`
    : formatCurrentMonthZh();
  const shownHealth = computePortfolioHealth(
    shownHoldings,
    shownHistory,
    travelDate ?? todayIsoDate()
  );
  const shownWeather = computeInvestmentWeather(
    shownSummary,
    shownBreakdowns.dailyUnrealized
  );

  const sections: Record<DashboardSectionId, ReactNode> = {
    summary: (
      <PortfolioSummaryCards summary={shownSummary} pnlBreakdowns={shownBreakdowns} view={viewFor("summary")} asOfDate={travelDate ?? undefined} />
    ),
    allocation: <AssetAllocationChart summary={shownSummary} view={viewFor("allocation")} />,
    quickStats: (
      <div className="glass-card h-full p-5">
        <h2 className="mb-3 text-sm font-medium text-muted">快速統計</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
              <span className="text-muted">持倉筆數</span>
              <span>{shownSummary.holdingCount}</span>
          </li>
            <li className="flex justify-between">
              <span className="text-muted">股票市值</span>
              <span>{shownSummary.stockValue.toLocaleString("zh-TW")} 元</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">基金市值</span>
              <span>{shownSummary.fundValue.toLocaleString("zh-TW")} 元</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">房子市值</span>
              <span>{shownSummary.propertyValue.toLocaleString("zh-TW")} 元</span>
            </li>
            <li className="flex justify-between border-t border-border/60 pt-2">
              <span className="text-muted">日未實現（今日）</span>
              <div className="text-right">
                <PnlValueWithBreakdown
                  title="日未實現"
                  value={
                    shownSummary.dailyUnrealizedPnl !== null
                      ? formatCurrency(shownSummary.dailyUnrealizedPnl)
                      : "—"
                  }
                  valueClassName={
                    shownSummary.dailyUnrealizedPnl === null
                      ? "text-muted"
                      : shownSummary.dailyUnrealizedPnl >= 0
                        ? "text-gain"
                        : "text-loss"
                  }
                  periodBreakdown={shownBreakdowns.dailyUnrealized}
                />
                {shownSummary.hasStaleFundNavOnDaily && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    基金淨值非今日
                  </p>
                )}
              </div>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">
                月未實現（{shownMonthLabel}）
              </span>
              <PnlValueWithBreakdown
                title="月未實現"
                value={
                  shownSummary.monthlyUnrealizedPnl !== null
                    ? formatCurrency(shownSummary.monthlyUnrealizedPnl)
                    : "—"
                }
                valueClassName={
                  shownSummary.monthlyUnrealizedPnl === null
                    ? "text-muted"
                    : shownSummary.monthlyUnrealizedPnl >= 0
                      ? "text-gain"
                      : "text-loss"
                }
                periodBreakdown={shownBreakdowns.monthlyUnrealized}
              />
            </li>
            <li className="flex justify-between">
              <span className="text-muted">
                月已實現（{shownMonthLabel}）
              </span>
              <span
                className={
                  shownSummary.monthlyRealizedPnl >= 0 ? "text-gain" : "text-loss"
                }
              >
                {formatCurrency(shownSummary.monthlyRealizedPnl)}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">累計已實現</span>
              <span
                className={
                  shownSummary.totalRealizedPnl >= 0 ? "text-gain" : "text-loss"
                }
              >
                {shownSummary.totalRealizedPnl.toLocaleString("zh-TW")} 元
              </span>
            </li>
        </ul>
      </div>
    ),
    exposure: (
      <ExposurePanel
        exposure={shownExposure}
        settings={storage.settings}
        onSaveSettings={setExposureSettings}
        view={viewFor("exposure")}
        readOnly={travelDate !== null}
      />
    ),
    monthlyPnl: (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">月度損益</h2>
        <MonthlyPnlTable
          holdings={shownRawHoldings}
          priceHistory={shownHistory}
          sales={shownSales}
          asOfDate={travelDate ?? undefined}
        />
      </section>
    ),
    trend: (
      <section className="glass-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold sm:text-lg">
            資產趨勢（今年度）
          </h2>
          <Link href="/trends" className="text-sm text-accent hover:underline">
            查看完整趨勢 →
          </Link>
        </div>
        <PortfolioValueTrendChart
          holdings={shownRawHoldings}
          priceHistory={shownHistory}
          range={travelDate ? "all" : "ytd"}
        />
      </section>
    ),
    holdings: (
      <section>
        <h2 className="mb-4 text-lg font-semibold">持倉摘要</h2>
        {travelDate || viewFor("holdings") === "visual" ? (
          <HoldingSnapshotCards holdings={shownHoldings} compact={viewFor("holdings") === "compact"} />
        ) : (
          <HoldingsTable holdings={viewFor("holdings") === "compact" ? shownHoldings.slice(0, 5) : shownHoldings} />
        )}
      </section>
    ),
  };

  return (
    <div className="ui-dashboard">
      <PageHeader
        title="投資總覽"
        description="台股、境內基金與房子持倉 · 本機儲存"
        action={
          <Link
            href="/holdings/new"
            className="btn-primary w-full sm:w-auto touch-target"
          >
            新增持倉
          </Link>
        }
      />

      <TimeTravelBar
        dates={historyDates}
        selectedDate={travelDate}
        onSelectDate={setTravelDate}
      />

      <PortfolioInsights health={shownHealth} weather={shownWeather} />

      <div className="dashboard-grid">
        {preferences.dashboardLayout
          .filter((item) => !item.hidden)
          .map((item) => (
            <div
              key={item.section}
              data-dashboard-section={item.section}
              data-grid-width={item.width}
              className="min-w-0"
            >
              {sections[item.section]}
            </div>
          ))}
      </div>
    </div>
  );
}

function HoldingSnapshotCards({ holdings, compact }: { holdings: HoldingWithMetrics[]; compact?: boolean }) {
  const visible = groupHoldingsWithMetrics(holdings)
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, compact ? 4 : 8);
  if (visible.length === 0) {
    return <div className="glass-card p-8 text-center text-sm text-muted">這個日期尚無持倉</div>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map((holding) => (
        <article key={holding.groupKey} className="glass-card min-w-0 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{holding.name}</p>
              <p className="text-xs text-muted">
                {holding.symbol}{holding.isMerged ? ` · ${holding.lots.length} 筆合併` : ""}
              </p>
            </div>
            <span className={`text-sm font-semibold ${holding.pnl >= 0 ? "text-gain" : "text-loss"}`}>
              {holding.returnRate > 0 ? "+" : ""}{holding.returnRate.toFixed(1)}%
            </span>
          </div>
          <p className="mt-5 text-lg font-semibold tabular-nums">{formatCurrency(holding.marketValue)}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted">成本</dt>
              <dd className="mt-0.5 truncate tabular-nums">{formatCurrency(holding.costBasis)}</dd>
            </div>
            <div className="text-right">
              <dt className="text-muted">損益</dt>
              <dd className={`mt-0.5 truncate font-medium tabular-nums ${holding.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {formatCurrency(holding.pnl)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
            <div className={`h-full rounded-full ${holding.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, Math.max(8, Math.abs(holding.returnRate)))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}
