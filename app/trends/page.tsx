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
import {
  CHART_RANGE_OPTIONS,
  getChartRangeLabel,
} from "@/lib/portfolio/chart-date-range";
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
  const isOtc = active?.assetType === "stock" && active.market === "otc";

  const importButtonLabel = isFund
    ? "從集保載入歷史淨值"
    : "從 TWSE 載入歷史股價";

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
      <div>
        <h1 className="text-2xl font-bold">趨勢分析</h1>
        <p className="mt-1 text-sm text-muted">
          資產總覽依持倉歷史價格加總；單一標的則顯示股價或淨值走勢
        </p>
      </div>

      {holdings.length === 0 ? (
        <p className="text-muted">請先新增持倉並更新價格</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex gap-1 rounded-lg border border-border p-1">
              <TabButton
                active={tab === "portfolio"}
                onClick={() => setTab("portfolio")}
              >
                我的資產
              </TabButton>
              <TabButton
                active={tab === "holding"}
                onClick={() => setTab("holding")}
              >
                單一標的
              </TabButton>
            </div>

            <div className="flex flex-wrap items-end gap-1">
              {CHART_RANGE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRange(key)}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    range === key
                      ? "bg-accent-dim text-accent font-medium"
                      : "text-muted hover:bg-surface-raised"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tab === "portfolio" ? (
            <section className="space-y-6">
              <div className="glass-card p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">資產市值趨勢</h2>
                    <p className="mt-1 text-xs text-muted">
                      每筆依各自買入日／買入價納入；新買入日成本階梯上升
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePortfolioRefresh}
                    disabled={isPortfolioLoading}
                    className="btn-primary text-sm"
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

              <div className="glass-card p-5">
                <PortfolioReturnChart
                  holdings={storage.holdings}
                  priceHistory={storage.priceHistory}
                  range={range}
                />
              </div>

              <div className="glass-card p-5">
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
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <span className="text-muted">選擇標的</span>
                  <select
                    value={activeId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setHistoryMessage(null);
                      setHistoryError(null);
                    }}
                    className="input-field mt-1 min-w-[200px]"
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
                  disabled={loadingHistory || isOtc}
                  className="btn-primary"
                  title={
                    isOtc ? "上櫃歷史股價暫不支援自動載入" : undefined
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

              {historyMessage && (
                <p className="text-sm text-accent">{historyMessage}</p>
              )}
              {historyError && (
                <ErrorAlert
                  message={historyError}
                  onDismiss={() => setHistoryError(null)}
                />
              )}

              <div className="glass-card p-5">
                {active && (
                  <PriceTrendChart
                    priceHistory={storage.priceHistory}
                    holdingId={active.id}
                    title={`${active.name} · ${active.assetType === "stock" ? "股價" : "淨值"}`}
                    range={range}
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
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-accent-dim text-accent"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
