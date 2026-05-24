"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
  periodPnlFromTimeline,
} from "@/lib/portfolio/portfolio-timeline";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";

/** 累積損益面積圖（類似庫存損益走勢） */
export function PortfolioReturnChart({
  holdings,
  priceHistory,
  range,
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  range: ChartRange;
}) {
  const timeline = useMemo(
    () => buildPortfolioTimeline(holdings, priceHistory, range),
    [holdings, priceHistory, range]
  );

  const periodSeries = useMemo(
    () => periodPnlFromTimeline(timeline),
    [timeline]
  );

  const chartData = timeline.map((p, i) => ({
    date: p.date.slice(5),
    fullDate: p.date,
    pnl: periodSeries[i]?.periodPnl ?? 0,
    returnRate: periodSeries[i]?.periodReturnRate ?? 0,
    absolutePnl: p.pnl,
    absoluteReturnRate: p.returnRate,
  }));

  if (chartData.length < 2) {
    return null;
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        累積損益
        <span className="ml-2 font-normal text-muted">（相對所選區間起點）</span>
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted)"
            tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
          />
          <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 4" />
          <Tooltip
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.fullDate ?? ""
            }
            formatter={(_, __, item) => {
              const row = item?.payload as {
                pnl: number;
                returnRate: number;
                absolutePnl: number;
              };
              if (!row) return ["", ""];
              return [
                `${formatCurrency(row.pnl)} (${formatPercent(row.returnRate)}) · 總損益 ${formatCurrency(row.absolutePnl)}`,
                "區間累積",
              ];
            }}
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
            }}
          />
          <Area
            type="monotone"
            dataKey="pnl"
            stroke="#10b981"
            fill="url(#pnlGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
