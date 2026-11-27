"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetAllocationChart } from "@/components/dashboard/AssetAllocationChart";
import { ExposurePanel } from "@/components/dashboard/ExposurePanel";
import { LoanSummaryPanel } from "@/components/loans/LoanSummaryPanel";
import { TimeTravelBar } from "@/components/dashboard/TimeTravelBar";
import { PortfolioSummaryCards } from "@/components/dashboard/PortfolioSummary";
import { PortfolioInsights } from "@/components/dashboard/PortfolioInsights";
import { RebalancePanel, StressTestPanel } from "@/components/dashboard/PortfolioPlanningTools";
import { ParallelUniversePanel } from "@/components/dashboard/ParallelUniversePanel";
import { WeeklyPortfolioReport } from "@/components/dashboard/WeeklyPortfolioReport";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AmountVisibilityToggle } from "@/components/ui/AmountVisibilityToggle";
import {
  currentYearMonthPrefix,
  formatCurrentMonthZh,
  formatIsoDateZh,
} from "@/lib/date/iso-date";
import {
  computePortfolioSummary,
  enrichHoldings,
} from "@/lib/portfolio/calculations";
import { computePortfolioExposure } from "@/lib/portfolio/exposure";
import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { buildPortfolioPnlBreakdowns } from "@/lib/portfolio/pnl-breakdown";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { calculatePortfolioLoanSummary } from "@/lib/loans/calculations";
import { calculatePortfolioLoanRisk } from "@/lib/loans/risk";
import { buildLoanReminders } from "@/lib/loans/reminders";
import { computePortfolioHealth } from "@/lib/portfolio/health";
import { computeInvestmentWeather } from "@/lib/portfolio/weather";
import { todayIsoDate } from "@/lib/date/iso-date";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { PnlValueWithBreakdown } from "@/components/ui/PnlBreakdownTooltip";
import type { DashboardSectionId } from "@/lib/types/ui-preferences";
import { DEFAULT_UI_PREFERENCES } from "@/lib/ui/preferences";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

const ANALYSIS_SECTIONS = new Set<DashboardSectionId>([
  "insights", "exposure", "weeklyReport", "stressTest", "rebalance", "parallelUniverse",
]);

export default function DashboardPage() {
  const { ready, holdings, summary, exposure, loanSummary, loanRiskSummary, loanReminders, pnlBreakdowns, storage, sales, setExposureSettings, setAllocationTargets } = usePortfolio();
  const { preferences } = useUiPreferences();
  const { formatAmount } = useAmountPrivacy();
  const [travelDate, setTravelDate] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const pnlCalendar = useMemo(
    () =>
      buildPnlCalendar(storage, {
        month: travelDate?.slice(0, 7) ?? currentYearMonthPrefix(),
        asOfDate: travelDate ?? todayIsoDate(),
        filter: { kind: "investment" },
      }),
    [storage, travelDate]
  );

  const portfolioHistory = useMemo(() => buildPortfolioHistory(storage), [storage]);
  const historyDates = useMemo(
    () => portfolioHistory.dates.filter((date) => date <= todayIsoDate()),
    [portfolioHistory]
  );
  const travelState = useMemo(() => {
    if (!travelDate) return null;
    const rawHoldings = portfolioHistory.snapshotOn(travelDate);
    const history = portfolioHistory.priceHistoryAt(travelDate);
    const enriched = enrichHoldings(rawHoldings);
    const visibleSales = sales.filter((sale) => sale.sellDate <= travelDate);
    const travelSummary = computePortfolioSummary(enriched, visibleSales, {
      holdingsForTimeline: rawHoldings,
      priceHistory: history,
      asOfDate: travelDate,
    });
    const grossInvestmentPnl =
      enriched
        .filter((holding) => holding.assetType !== "property")
        .reduce((sum, holding) => sum + holding.pnl, 0) +
      visibleSales
        .filter((sale) => sale.assetType !== "property")
        .reduce((sum, sale) => sum + sale.realizedPnl, 0);
    const loanRisk = calculatePortfolioLoanRisk(storage.loans, rawHoldings, travelDate, storage.corporateActions);
    return {
      rawHoldings,
      history,
      holdings: enriched,
      sales: visibleSales,
      summary: travelSummary,
      loanSummary: calculatePortfolioLoanSummary(storage.loans, {
        asOfDate: travelDate,
        grossInvestmentPnl,
      }),
      loanRiskSummary: loanRisk.summary,
      loanReminders: buildLoanReminders(
        storage.loans,
        rawHoldings,
        travelDate,
        storage.corporateActions,
        loanRisk.valuations
      ),
      exposure: computePortfolioExposure(
        enriched,
        {},
        storage.loans,
        travelDate
      ),
      pnlBreakdowns: buildPortfolioPnlBreakdowns(enriched, history, travelDate),
    };
  }, [portfolioHistory, sales, storage.loans, storage.corporateActions, travelDate]);

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
  const shownLoanSummary = travelState?.loanSummary ?? loanSummary;
  const shownLoanRiskSummary =
    travelState?.loanRiskSummary ?? loanRiskSummary;
  const shownLoanReminders = travelState?.loanReminders ?? loanReminders;
  const viewFor = (section: DashboardSectionId) =>
    preferences.dashboardLayout.find((item) => item.section === section)?.view ??
    "standard";
  const monthRate = pnlCalendar.summary.returnRate;
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
    shownBreakdowns.dailyUnrealized,
    formatAmount,
  );
  const hasPortfolio = holdings.length > 0 || sales.length > 0 ||
    (storage.holdingRemovals?.length ?? 0) > 0 || storage.transactions.length > 0 ||
    Object.keys(storage.pnlTracking.dailySummaries).length > 0;
  const visibleLayout = preferences.dashboardLayout.filter(
    (item) => !item.hidden && (item.section !== "timeTravel" || historyDates.length > 0)
  );
  const defaultLayout = DEFAULT_UI_PREFERENCES.dashboardLayout;
  const usesDefaultLayout = preferences.dashboardLayout.every((item, index) => {
    const defaults = defaultLayout[index];
    return defaults && item.section === defaults.section && item.width === defaults.width &&
      item.hidden === defaults.hidden && item.view === defaults.view;
  });
  const analysisLayout = hasPortfolio && usesDefaultLayout
    ? visibleLayout.filter((item) => ANALYSIS_SECTIONS.has(item.section))
    : [];
  const mainLayout = analysisLayout.length > 0
    ? visibleLayout.filter((item) => !ANALYSIS_SECTIONS.has(item.section))
    : visibleLayout;
  const loanPanel = shownLoanSummary.activeLoanCount > 0 || shownLoanSummary.investmentFinancingCostToDate !== 0 || shownLoanSummary.hasIncompleteData ? (
    <div data-grid-width="full">
      <LoanSummaryPanel summary={shownLoanSummary} riskSummary={shownLoanRiskSummary} reminders={shownLoanReminders} />
    </div>
  ) : null;

  const sections: Record<DashboardSectionId, ReactNode> = {
    timeTravel: (
      <TimeTravelBar
        dates={historyDates}
        selectedDate={travelDate}
        onSelectDate={setTravelDate}
        currentSummary={summary}
        selectedSummary={travelState?.summary}
        historyNotice={portfolioHistory.unknownStartCount ? `${portfolioHistory.unknownStartCount} 筆舊賣出持倉缺少買入日期，未列入歷史快照。` : undefined}
        view={viewFor("timeTravel")}
      />
    ),
    insights: (
      <PortfolioInsights
        health={shownHealth}
        weather={shownWeather}
        view={viewFor("insights")}
      />
    ),
    weeklyReport: (
      <WeeklyPortfolioReport
        storage={storage}
        portfolioHistory={portfolioHistory}
        asOfDate={travelDate ?? todayIsoDate()}
        view={viewFor("weeklyReport")}
      />
    ),
    stressTest: (
      <StressTestPanel holdings={shownHoldings} view={viewFor("stressTest")} />
    ),
    rebalance: (
      <RebalancePanel
        summary={shownSummary}
        savedTargets={storage.settings.allocationTargets}
        onSaveTargets={setAllocationTargets}
        readOnly={travelDate !== null}
        view={viewFor("rebalance")}
      />
    ),
    parallelUniverse: (
      <ParallelUniversePanel
        holdings={shownHoldings}
        priceHistory={storage.priceHistory}
        corporateActions={storage.corporateActions}
        asOfDate={travelDate ?? undefined}
        view={viewFor("parallelUniverse")}
      />
    ),
    summary: (
      <section className="metric-grid-container space-y-3" aria-labelledby="portfolio-summary-title">
        <h2 id="portfolio-summary-title" className="text-lg font-semibold">資產概況</h2>
        <p className="text-sm text-muted">
          {travelDate
            ? `回看 ${formatIsoDateZh(travelDate)} · 依當日持有的部位與可用估值重建`
            : `截至 ${formatIsoDateZh(todayIsoDate())} · 各筆採最新可用估值`}
        </p>
        <PortfolioSummaryCards summary={shownSummary} pnlBreakdowns={shownBreakdowns} view={viewFor("summary")} asOfDate={travelDate ?? undefined} />
      </section>
    ),
    allocation: (
      <AssetAllocationChart
        summary={shownSummary}
        holdings={shownHoldings}
        view={viewFor("allocation")}
      />
    ),
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
              <span>{formatAmount(shownSummary.stockValue)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">基金市值</span>
              <span>{formatAmount(shownSummary.fundValue)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">房子市值</span>
              <span>{formatAmount(shownSummary.propertyValue)}</span>
            </li>
            <li className="flex justify-between border-t border-border/60 pt-2">
              <span className="text-muted">日未實現（最近估值日）</span>
              <div className="text-right">
                <PnlValueWithBreakdown
                  title="日未實現"
                  value={
                    shownSummary.dailyUnrealizedPnl !== null
                      ? formatAmount(shownSummary.dailyUnrealizedPnl)
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
                {shownSummary.dailyValuationStartDate && shownSummary.dailyValuationEndDate && (
                  <p className="text-xs text-muted">
                    {shownSummary.dailyValuationEndDate.slice(5).replace("-", "/")} 相對 {shownSummary.dailyValuationStartDate.slice(5).replace("-", "/")}
                  </p>
                )}
                {shownSummary.dailyValuationUsesPreviousDate ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    可能休市或行情尚未更新
                  </p>
                ) : shownSummary.hasStaleFundNavOnDaily && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    部分基金淨值非今日
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
                    ? formatAmount(shownSummary.monthlyUnrealizedPnl)
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
                {formatAmount(shownSummary.monthlyRealizedPnl)}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">累計已實現</span>
              <span
                className={
                  shownSummary.totalRealizedPnl >= 0 ? "text-gain" : "text-loss"
                }
              >
                {formatAmount(shownSummary.totalRealizedPnl)}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">月度損益</h2>
            {pnlCalendar.summary.dataDayCount > 0 && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className={`text-2xl font-semibold tabular-nums ${pnlCalendar.summary.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {pnlCalendar.summary.pnl > 0 ? "+" : ""}
                  {formatAmount(pnlCalendar.summary.pnl)}
                </span>
                {monthRate !== null && (
                  <span className={`text-sm tabular-nums ${monthRate >= 0 ? "text-gain" : "text-loss"}`}>
                    {travelDate ? `${shownMonthLabel}複利` : "本月複利"} {monthRate > 0 ? "+" : ""}{monthRate.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
          </div>
          <Link href="/calendar" className="text-sm font-medium text-accent hover:underline">
            查看損益日曆 →
          </Link>
        </div>
        <MonthlyPnlTable
          storage={storage}
          asOfDate={travelDate ?? undefined}
        />
      </section>
    ),
    trend: (
      <section className="glass-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold sm:text-lg">
            歷史持倉市值（{travelDate ? `截至 ${formatIsoDateZh(travelDate)}` : "今年度"}）
          </h2>
          <Link href="/trends" className="text-sm text-accent hover:underline">
            查看完整趨勢 →
          </Link>
        </div>
        <PortfolioValueTrendChart
          holdings={shownRawHoldings}
          priceHistory={shownHistory}
          range={travelDate ? "all" : "ytd"}
          portfolioHistory={portfolioHistory}
          asOfDate={travelDate ?? undefined}
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

  function renderSections(layout: typeof visibleLayout) {
    return layout.map((item) => (
      <Fragment key={item.section}>
        <div
          data-dashboard-section={item.section}
          data-grid-width={item.width}
          className="min-w-0"
        >
          {sections[item.section]}
        </div>
        {hasPortfolio && item.section === "summary" && loanPanel}
      </Fragment>
    ));
  }

  const dashboard = (
    <div className="dashboard-grid">
      {hasPortfolio && !visibleLayout.some((item) => item.section === "summary") && loanPanel}
      {renderSections(mainLayout)}
    </div>
  );

  return (
    <div className="ui-dashboard">
      <PageHeader
        title="投資總覽"
        description="掌握台股、境內基金與房產的市值及損益。"
        action={hasPortfolio ? (
          <div className="flex w-full gap-2 sm:w-auto">
            <AmountVisibilityToggle />
            <Link href="/holdings/new" className="btn-primary min-w-0 flex-1 sm:flex-none">新增持倉</Link>
          </div>
        ) : undefined}
      />

      {hasPortfolio ? (
        <>
          {dashboard}
          {analysisLayout.length > 0 && (
            <details
              className="rounded-xl border border-border bg-surface"
              onToggle={(event) => setAnalysisOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold">
                進階分析與規劃
              </summary>
              {analysisOpen && (
                <div className="dashboard-grid border-t border-border p-4 sm:p-5">{renderSections(analysisLayout)}</div>
              )}
            </details>
          )}
        </>
      ) : (
        <>
          <EmptyState
            title="建立第一筆持倉"
            description="輸入買入日期、價格與數量，即可開始追蹤市值和損益。已有備份可直接匯入。"
            action={
              <>
                <Link href="/holdings/new" className="btn-primary">新增持倉</Link>
                <Link href="/holdings#portfolio-backup" className="btn-secondary">匯入備份</Link>
              </>
            }
          />
          {loanPanel}
          <details className="rounded-xl border border-border bg-surface">
            <summary className="cursor-pointer rounded-xl px-5 py-3.5 text-sm font-medium">展開總覽與分析工具</summary>
            <div className="border-t border-border p-4 sm:p-5">{dashboard}</div>
          </details>
        </>
      )}
    </div>
  );
}

function HoldingSnapshotCards({ holdings, compact }: { holdings: HoldingWithMetrics[]; compact?: boolean }) {
  const { formatAmount } = useAmountPrivacy();
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
          <p className="mt-5 text-lg font-semibold tabular-nums">{formatAmount(holding.marketValue)}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted">成本</dt>
              <dd className="mt-0.5 truncate tabular-nums">{formatAmount(holding.costBasis)}</dd>
            </div>
            <div className="text-right">
              <dt className="text-muted">損益</dt>
              <dd className={`mt-0.5 truncate font-medium tabular-nums ${holding.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {formatAmount(holding.pnl)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
            <div className={`h-full rounded-full ${holding.pnl >= 0 ? "bg-gain" : "bg-loss"}`} style={{ width: `${Math.min(100, Math.max(8, Math.abs(holding.returnRate)))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}
