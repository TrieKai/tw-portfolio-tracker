"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartRange } from "@/lib/portfolio/calculations";
import { formatPercent } from "@/lib/portfolio/calculations";
import {
  buildPortfolioTimeline,
  summarizePortfolioPeriod,
  summarizeTimelineChange,
} from "@/lib/portfolio/portfolio-timeline";
import type { PortfolioHistory } from "@/lib/portfolio/time-travel";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";
import { ChartFrame } from "@/components/ui/ChartFrame";
import { PortfolioTimelineTooltip } from "./PortfolioTimelineTooltip";
import { formatAmountAxisTick, historyDateAxis } from "./chart-axes";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

interface PortfolioValueTrendChartProps {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  range: ChartRange;
  portfolioHistory?: PortfolioHistory;
  asOfDate?: string;
}

export function PortfolioValueTrendChart({
  holdings,
  priceHistory,
  range,
  portfolioHistory,
  asOfDate,
}: PortfolioValueTrendChartProps) {
  const { amountsHidden, formatAmount } = useAmountPrivacy();
  const timeline = useMemo(
    () => buildPortfolioTimeline(holdings, priceHistory, range, portfolioHistory, asOfDate),
    [holdings, priceHistory, range, portfolioHistory, asOfDate]
  );

  const summary = useMemo(
    () => summarizeTimelineChange(timeline),
    [timeline]
  );

  const periodSummary = useMemo(
    () => summarizePortfolioPeriod(portfolioHistory?.initialLots ?? holdings, timeline, range),
    [holdings, portfolioHistory, timeline, range]
  );

  const chartData = timeline.map((p) => ({
    ...p,
    timestamp: Date.parse(p.date),
  }));

  /** 買入建倉日（用於圖上標記） */
  const buyDates = chartData.filter((point) => point.costAddedToday > 0);

  if (chartData.length < 2) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted">
        <p>至少需要 2 個交易日的價格資料才能繪製資產趨勢</p>
        <p className="text-xs">
          各筆持倉會依各自買入日納入；請載入區間內歷史價格
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        顯示期間 {timeline[0].date}～{timeline.at(-1)?.date} · {timeline.length} 個估值日
        {portfolioHistory && " · 市值變化反映買賣與價格變動"}
      </p>
      {portfolioHistory && (
        <p className="text-xs text-muted">
          缺少當日行情時，沿用最近行情或以成本價估計。
          {portfolioHistory.estimatedStartCount > 0 && ` ${portfolioHistory.estimatedStartCount} 筆舊持倉從已知追蹤日回推。`}
          {portfolioHistory.unknownStartCount > 0 && ` ${portfolioHistory.unknownStartCount} 筆舊賣出持倉缺少買入日期，未列入圖表。`}
        </p>
      )}
      {summary && (
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="期初市值" value={formatAmount(summary.startValue)} />
          <Stat label="期末市值" value={formatAmount(summary.endValue)} />
          <Stat
            label="市值變化"
            value={`${formatAmount(summary.change)} (${formatPercent(summary.changePercent)})`}
            highlight={summary.change >= 0 ? "gain" : "loss"}
          />
          {periodSummary && (
            <Stat
              label="期間新投入"
              value={formatAmount(periodSummary.costAddedInPeriod)}
              sub={
                periodSummary.lotsAddedInPeriod.length > 0
                  ? `${periodSummary.lotsAddedInPeriod.length} 筆新買入`
                  : "無新買入"
              }
            />
          )}
        </div>
      )}

      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis {...historyDateAxis(chartData[0].date, chartData[chartData.length - 1].date)} />
          <YAxis
            tick={amountsHidden ? false : { fontSize: 11 }}
            stroke="var(--muted)"
            domain={["auto", "auto"]}
            tickFormatter={formatAmountAxisTick}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]?.payload) return null;
              const point = payload[0].payload as (typeof chartData)[0];
              return (
                <div
                  className="rounded-lg border border-border p-3 shadow-lg"
                  style={{ background: "var(--tooltip-bg)" }}
                >
                  <PortfolioTimelineTooltip point={point} />
                </div>
              );
            }}
          />
          <Legend
            formatter={(value) =>
              value === "totalValue"
                ? "總市值"
                : value === "totalCost"
                  ? "剩餘持倉成本"
                  : String(value)
            }
          />
          {buyDates.map((point) => (
            <ReferenceLine
              key={point.date}
              x={point.timestamp}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          ))}
          {buyDates.map((point) => (
            <ReferenceDot
              key={`dot-${point.date}`}
              x={point.timestamp}
              y={point.totalCost}
              r={4}
              fill="#3b82f6"
              stroke="var(--page)"
              strokeWidth={1}
            />
          ))}
          <Line
            type="linear"
            dataKey="totalValue"
            name="totalValue"
            stroke="#10b981"
            strokeWidth={2.5}
            dot={chartData.length <= 40}
            activeDot={{ r: 4 }}
          />
          <Line
            type="stepAfter"
            dataKey="totalCost"
            name="totalCost"
            stroke="#94a3b8"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      {buyDates.length > 0 && (
        <p className="text-xs text-muted">
          垂直虛線／藍點：新買入建倉日（成本階梯上升）；每筆持倉以各自買入價與買入日獨立計算。
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "gain" | "loss";
}) {
  const valueClass =
    highlight === "gain"
      ? "text-gain"
      : highlight === "loss"
        ? "text-loss"
        : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-muted">{label}</p>
      <p className={`font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
