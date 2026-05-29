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
import { formatCurrency, formatPercent } from "@/lib/portfolio/calculations";
import {
  buildPortfolioTimeline,
  summarizePortfolioPeriod,
  summarizeTimelineChange,
} from "@/lib/portfolio/portfolio-timeline";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";
import { ChartFrame } from "@/components/ui/ChartFrame";
import { PortfolioTimelineTooltip } from "./PortfolioTimelineTooltip";

interface PortfolioValueTrendChartProps {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  range: ChartRange;
}

export function PortfolioValueTrendChart({
  holdings,
  priceHistory,
  range,
}: PortfolioValueTrendChartProps) {
  const timeline = useMemo(
    () => buildPortfolioTimeline(holdings, priceHistory, range),
    [holdings, priceHistory, range]
  );

  const summary = useMemo(
    () => summarizeTimelineChange(timeline),
    [timeline]
  );

  const periodSummary = useMemo(
    () => summarizePortfolioPeriod(holdings, timeline, range),
    [holdings, timeline, range]
  );

  const chartData = timeline.map((p) => ({
    ...p,
    dateLabel: p.date.slice(5),
  }));

  /** 買入建倉日（用於圖上標記） */
  const buyMarkers = useMemo(() => {
    const seen = new Set<string>();
    const markers: { date: string; cost: number; names: string }[] = [];
    for (const p of timeline) {
      if (p.costAddedToday > 0 && !seen.has(p.date)) {
        seen.add(p.date);
        markers.push({
          date: p.date.slice(5),
          cost: p.totalCost,
          names: p.newHoldings.join("、"),
        });
      }
    }
    return markers;
  }, [timeline]);

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
      {summary && (
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="期初市值" value={formatCurrency(summary.startValue)} />
          <Stat label="期末市值" value={formatCurrency(summary.endValue)} />
          <Stat
            label="市值變化"
            value={`${formatCurrency(summary.change)} (${formatPercent(summary.changePercent)})`}
            highlight={summary.change >= 0 ? "gain" : "loss"}
          />
          {periodSummary && (
            <Stat
              label="期間新投入"
              value={formatCurrency(periodSummary.costAddedInPeriod)}
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
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11 }}
            stroke="var(--muted)"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted)"
            domain={["auto", "auto"]}
            tickFormatter={(v) =>
              v >= 10000 ? `${Math.round(Number(v) / 10000)}萬` : String(v)
            }
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
                  ? "累計投入成本"
                  : String(value)
            }
          />
          {buyMarkers.map((m) => (
            <ReferenceLine
              key={m.date}
              x={m.date}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          ))}
          {buyMarkers.map((m) => (
            <ReferenceDot
              key={`dot-${m.date}`}
              x={m.date}
              y={m.cost}
              r={4}
              fill="#3b82f6"
              stroke="var(--page)"
              strokeWidth={1}
            />
          ))}
          <Line
            type="monotone"
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

      {buyMarkers.length > 0 && (
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
