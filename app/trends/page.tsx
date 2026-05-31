"use client";

import { useMemo, useState } from "react";
import { PortfolioReturnChart } from "@/components/charts/PortfolioReturnChart";
import { PortfolioValueTrendChart } from "@/components/charts/PortfolioValueTrendChart";
import { HoldingLotsTable } from "@/components/portfolio/HoldingLotsTable";
import { buildHoldingLotSummaries } from "@/lib/portfolio/portfolio-timeline";
import { PriceTrendChart } from "@/components/charts/PriceTrendChart";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { ChartRange } from "@/lib/portfolio/calculations";
import { ChartRangePicker } from "@/components/ui/ChartRangePicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { getChartRangeLabel } from "@/lib/portfolio/chart-date-range";
import { canImportHistory } from "@/lib/client/holding-history";
import { usePortfolio } from "@/providers/PortfolioProvider";

type TrendTab = "portfolio" | "holding";

export default function TrendsPage() {
  const {
    ready,
    holdings,
    storage,
    importPriceHistory,
    refreshPortfolioForRange,
    batchStatus,
    batchMessage,
  } = usePortfolio();
  const [tab, setTab] = useState<TrendTab>("portfolio");
  const [selectedId, setSelectedId] = useState<string>("");
  const [range, setRange] = useState<ChartRange>("30d");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const holdingLots = useMemo(
    () => buildHoldingLotSummaries(storage.holdings),
    [storage.holdings]
  );

  if (!ready) return <LoadingSpinner />;

  const activeId = selectedId || holdings[0]?.id || "";
  const active = holdings.find((h) => h.id === activeId);
  const isFund = active?.assetType === "fund";
  const isProperty = active?.assetType === "property";
  const isOtc = active?.assetType === "stock" && active.market === "otc";
  const canImport = active ? canImportHistory(active) : false;

  const importButtonLabel = isFund
    ? "從集保載入歷史淨值"
    : "從 TWSE 載入歷史股價";

  const priceSeriesLabel = isProperty ? "估價" : isFund ? "淨值" : "股價";

  const isPortfolioLoading = batchStatus === "loading";

  async function handlePortfolioRefresh() {
    setHistoryError(null);
    setHistoryMessage(null);
    const result = await refreshPortfolioForRange(range);
    if (result.ok) {
      setHistoryMessage(
        result.message ??
          `已更新現價並載入「${getChartRangeLabel(range)}」歷史資料`
      );
    } else {
      setHistoryError(result.error ?? "更新失敗");
    }
  }

  async function handleImportHistory() {
    if (!active) return;
    setLoadingHistory(true);
    setHistoryError(null);
    setHistoryMessage(null);

    const result = await importPriceHistory(active.id, range);
    setLoadingHistory(false);

    if (result.ok) {
      setHistoryMessage(
        `已載入 ${result.count ?? 0} 筆歷史${isFund ? "淨值" : "收盤價"}並合併至本機趨勢`
      );
    } else {
      setHistoryError(result.error ?? "載入歷史資料失敗，請稍後再試");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="趨勢分析"
        description="資產總覽依持倉歷史價格加總；單一標的則顯示股價或淨值走勢"
      />

      {holdings.length === 0 ? (
        <p className="text-muted">請先新增持倉並更新價格</p>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex w-full gap-1 rounded-lg border border-border p-1">
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
                    <h2 className="font-semibold">資產市值趨勢</h2>
                    <p className="mt-1 text-xs text-muted">
                      每筆依各自買入日／買入價納入；新買入日成本階梯上升
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePortfolioRefresh}
                    disabled={isPortfolioLoading}
                    className="btn-primary w-full shrink-0 text-sm sm:w-auto touch-target"
                  >
                    {isPortfolioLoading
                      ? "更新中…"
                      : `更新現價並載入${getChartRangeLabel(range)}歷史`}
                  </button>
                </div>
                {(historyMessage || batchMessage) && tab === "portfolio" && (
                  <p className="mb-3 text-sm text-accent">
                    {historyMessage ?? batchMessage}
                  </p>
                )}
                {historyError && tab === "portfolio" && (
                  <div className="mb-3">
                    <ErrorAlert
                      message={historyError}
                      onDismiss={() => setHistoryError(null)}
                    />
                  </div>
                )}
                <PortfolioValueTrendChart
                  holdings={storage.holdings}
                  priceHistory={storage.priceHistory}
                  range={range}
                />
              </div>

              <div className="glass-card p-4 sm:p-5">
                <PortfolioReturnChart
                  holdings={storage.holdings}
                  priceHistory={storage.priceHistory}
                  range={range}
                />
              </div>

              <div className="glass-card p-4 sm:p-5">
                <h2 className="mb-1 font-semibold">持倉建倉明細</h2>
                <p className="mb-4 text-xs text-muted">
                  各筆基金／股票可不同時間、不同價格買入；趨勢圖僅在買入日後計入該筆
                </p>
                <HoldingLotsTable lots={holdingLots} />
              </div>

              <p className="text-xs text-muted">
                此按鈕會一次更新所有持倉最新價格，並向集保／TWSE
                載入目前區間的歷史資料；上櫃股票僅更新現價，歷史請手動累積。
              </p>
            </section>
          ) : (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="block w-full text-sm sm:min-w-[200px] sm:flex-1">
                  <span className="text-muted">選擇標的</span>
                  <select
                    value={activeId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setHistoryMessage(null);
                      setHistoryError(null);
                    }}
                    className="input-field mt-1 w-full"
                  >
                    {holdings.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.symbol})
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

              {historyMessage && (
                <p className="text-sm text-accent">{historyMessage}</p>
              )}
              {historyError && (
                <ErrorAlert
                  message={historyError}
                  onDismiss={() => setHistoryError(null)}
                />
              )}

              <div className="glass-card p-4 sm:p-5">
                {active && (
                  <PriceTrendChart
                    priceHistory={storage.priceHistory}
                    holdingId={active.id}
                    title={`${active.name} · ${priceSeriesLabel}`}
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
