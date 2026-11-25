"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PortfolioReturnChart } from "@/components/charts/PortfolioReturnChart";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingLotsTable } from "@/components/portfolio/HoldingLotsTable";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { buildHoldingLotSummaries } from "@/lib/portfolio/portfolio-timeline";
import { PriceTrendChart } from "@/components/charts/PriceTrendChart";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ChartRange } from "@/lib/portfolio/calculations";
import { ChartRangePicker } from "@/components/ui/ChartRangePicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { getChartRangeLabel } from "@/lib/portfolio/chart-date-range";
import { MAX_STOCK_HISTORY_MONTHS } from "@/lib/prices/stock-history-types";
import { canImportHistory } from "@/lib/client/holding-history";
import { groupHoldings } from "@/lib/portfolio/holding-groups";
import { usePortfolio } from "@/providers/PortfolioProvider";

type TrendTab = "portfolio" | "holding";
type HistoryNotice = { scope: string; text: string; error: boolean };

export default function TrendsPage() {
  const {
    ready,
    holdings,
    storage,
    importPriceHistory,
    refreshPortfolioForRange,
    batchStatus,
  } = usePortfolio();
  const [tab, setTab] = useState<TrendTab>("portfolio");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>("");
  const [range, setRange] = useState<ChartRange>("30d");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [portfolioNotice, setPortfolioNotice] = useState<HistoryNotice | null>(null);
  const [holdingNotice, setHoldingNotice] = useState<HistoryNotice | null>(null);

  const portfolioHistory = useMemo(() => buildPortfolioHistory(storage), [storage]);
  const holdingLots = useMemo(
    () => buildHoldingLotSummaries(portfolioHistory.initialLots),
    [portfolioHistory]
  );

  const symbolGroups = useMemo(
    () => groupHoldings(storage.holdings),
    [storage.holdings]
  );

  if (!ready) return <LoadingSpinner />;

  const activeGroup =
    symbolGroups.find((g) => g.groupKey === selectedGroupKey) ??
    symbolGroups[0];
  const active = activeGroup?.lots[0];
  const isFund = active?.assetType === "fund";
  const isProperty = active?.assetType === "property";
  const isOtc = active?.assetType === "stock" && active.market === "otc";
  const canImport = active ? canImportHistory(active) : false;

  const importButtonLabel = isFund
    ? "從集保載入歷史淨值"
    : "從 TWSE 載入歷史股價";

  const priceSeriesLabel = isProperty ? "估價" : isFund ? "淨值" : "股價";

  const isPortfolioLoading = batchStatus === "loading";
  const scope = tab === "portfolio" ? `portfolio:${range}` : `holding:${activeGroup?.groupKey}:${range}`;
  const historyNotice = tab === "portfolio" ? portfolioNotice : holdingNotice;
  const notice = historyNotice?.scope === scope ? historyNotice : null;

  async function handlePortfolioRefresh() {
    setPortfolioNotice(null);
    const result = await refreshPortfolioForRange(range);
    setPortfolioNotice({
      scope,
      text: (result.ok ? result.message : result.error) ?? "更新失敗，請再試一次。",
      error: !result.ok,
    });
  }

  async function handleImportHistory() {
    if (!activeGroup || loadingHistory) return;
    setLoadingHistory(true);
    setHoldingNotice(null);
    try {
      const result = await importPriceHistory(activeGroup.groupKey, range);
      const coverage = result.startDate && result.endDate
        ? `（${result.startDate}～${result.endDate}）`
        : "";
      setHoldingNotice({
        scope,
        text: result.ok
          ? `已儲存 ${result.count ?? 0} 筆歷史${isFund ? "淨值" : "收盤價"}${coverage}。${result.skippedCount ? `略過 ${result.skippedCount} 筆已保留或無需更新的價格。` : ""}`
          : result.error ?? "載入歷史資料失敗，請稍後再試。",
        error: !result.ok,
      });
    } finally {
      setLoadingHistory(false);
    }
  }

  const status = notice && (notice.error ? (
    <ErrorAlert message={notice.text} onDismiss={() => tab === "portfolio" ? setPortfolioNotice(null) : setHoldingNotice(null)} />
  ) : <p role="status" className="text-sm text-accent">{notice.text}</p>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="趨勢分析"
        description="比較持倉總市值、成本與報酬，或查看單一標的的價格走勢。"
      />

      {holdings.length === 0 && holdingLots.length === 0 ? (
        <EmptyState
          title="新增持倉後即可查看趨勢"
          description={portfolioHistory.unknownStartCount > 0 ? "現有舊賣出紀錄缺少買入日期，仍可在持倉頁查看賣出明細。" : "累積至少兩筆價格後，就能比較不同日期的市值與報酬。"}
          action={<Link href="/holdings/new" className="btn-primary">新增持倉</Link>}
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex shrink-0 gap-1 rounded-lg bg-surface-raised p-1" role="group" aria-label="趨勢檢視">
              <TabButton
                active={tab === "portfolio"}
                onClick={() => setTab("portfolio")}
                className="flex-1"
              >
                我的資產
              </TabButton>
              <TabButton
                active={tab === "holding"}
                onClick={() => setTab("holding")}
                className="flex-1"
              >
                單一標的
              </TabButton>
            </div>

            <ChartRangePicker value={range} onChange={setRange} />
          </div>

          {tab === "portfolio" ? (
            <section className="space-y-6">
              <div className="glass-card p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-semibold">歷史持倉市值</h2>
                    <p className="mt-1 text-xs text-muted">
                      按各日持有的數量估值，買入、賣出與公司行動會反映在市值與成本。
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      到 <Link href="/calendar" className="font-medium text-accent hover:underline">損益日曆</Link> 查看逐日損益及交易歸因。
                    </p>
                  </div>
                  {holdings.length > 0 && <button
                    type="button"
                    onClick={handlePortfolioRefresh}
                    disabled={isPortfolioLoading}
                    className="btn-primary w-full shrink-0 text-sm sm:w-auto touch-target"
                  >
                    {isPortfolioLoading
                      ? "更新中…"
                      : range === "all" ? "更新現價並載入歷史" : `更新現價並載入${getChartRangeLabel(range)}歷史`}
                  </button>}
                </div>
                {status && <div className="mb-3">{status}</div>}
                <PortfolioValueTrendChart
                  holdings={storage.holdings}
                  priceHistory={storage.priceHistory}
                  range={range}
                  portfolioHistory={portfolioHistory}
                />
              </div>

              <div className="glass-card p-4 sm:p-5">
                <PortfolioReturnChart
                  holdings={storage.holdings}
                  priceHistory={storage.priceHistory}
                  range={range}
                  portfolioHistory={portfolioHistory}
                />
              </div>

              <div className="glass-card p-4 sm:p-5">
                <h2 className="mb-1 font-semibold">持倉建倉明細</h2>
                <p className="mb-4 text-xs text-muted">
                  各筆持倉自買入日起計入趨勢圖，出清或移除後停止計入。
                </p>
                <HoldingLotsTable lots={holdingLots} />
              </div>

              {holdings.length > 0 && <p className="text-xs text-muted">
                此按鈕會一次更新所有持倉最新價格，並向集保／TWSE
                載入目前區間的歷史資料；上櫃股票僅更新現價，歷史請手動累積。
              </p>}
            </section>
          ) : !activeGroup ? (
            <EmptyState title="目前沒有持倉" description="已出清或移除的部位可在「我的資產」查看歷史市值。" />
          ) : (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="block w-full text-sm sm:min-w-[200px] sm:flex-1">
                  <span className="text-muted">選擇標的</span>
                  <select
                    value={activeGroup?.groupKey ?? ""}
                    onChange={(e) => setSelectedGroupKey(e.target.value)}
                    className="input-field mt-1 w-full"
                  >
                    {symbolGroups.map((g) => (
                      <option key={g.groupKey} value={g.groupKey}>
                        {g.name} ({g.symbol})
                        {g.isMerged ? ` · ${g.lots.length} 筆` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={handleImportHistory}
                  disabled={loadingHistory || !canImport}
                  className="btn-primary w-full sm:w-auto touch-target"
                  title={
                    isOtc
                      ? "上櫃歷史股價暫不支援自動載入"
                      : isProperty
                        ? "房子需透過「估價」手動累積歷史"
                        : undefined
                  }
                >
                  {loadingHistory ? "載入中…" : importButtonLabel}
                </button>
              </div>

              {isOtc && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  上櫃股票暫無法自動載入歷史股價，請使用「更新」或「手動」累積資料點。
                </p>
              )}

              {isProperty && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  房子無法自動載入歷史估價，請在持倉列表使用「估價」更新，趨勢圖會依每次估價累積資料點。
                </p>
              )}

              {status}
              {range === "all" && canImport && !isFund && (
                <p className="text-sm text-muted">單次上市股價查詢最多涵蓋 {MAX_STOCK_HISTORY_MONTHS} 個月。圖表顯示此標的已保存的可用資料。</p>
              )}

              <div className="glass-card p-4 sm:p-5">
                {activeGroup && active && (
                  <PriceTrendChart
                    priceHistory={storage.priceHistory}
                    holdingIds={activeGroup.lots.map((l) => l.id)}
                    title={`${active.name} · ${priceSeriesLabel}${
                      activeGroup.isMerged
                        ? ` · ${activeGroup.lots.length} 筆持倉`
                        : ""
                    }`}
                    range={range}
                    assetType={active.assetType}
                  />
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-2.5 text-sm font-medium transition touch-target sm:px-4 ${
        active
          ? "bg-accent-dim text-accent"
          : "text-muted hover:text-foreground"
      } ${className}`}
    >
      {children}
    </button>
  );
}
