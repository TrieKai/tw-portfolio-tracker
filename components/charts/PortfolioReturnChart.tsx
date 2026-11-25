"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
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
import { formatPercent } from "@/lib/portfolio/calculations";
import {
  buildPortfolioTimeline,
} from "@/lib/portfolio/portfolio-timeline";
import type { PortfolioHistory } from "@/lib/portfolio/time-travel";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";
import { ChartFrame } from "@/components/ui/ChartFrame";

/** 累積損益面積圖（類似庫存損益走勢） */
export function PortfolioReturnChart({
  holdings,
  priceHistory,
  range,
  portfolioHistory,
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  range: ChartRange;
  portfolioHistory: PortfolioHistory;
}) {
  const { formatAmount, amountsHidden } = useAmountPrivacy();
  const timeline = useMemo(
    () => buildPortfolioTimeline(holdings, priceHistory, range, portfolioHistory),
    [holdings, priceHistory, range, portfolioHistory]
  );

  const chartData = timeline.map((point) => ({
    date: point.date.slice(5),
    fullDate: point.date,
    pnl: point.pnl,
    returnRate: point.activeHoldings > 0 ? point.returnRate : null,
  }));

  if (chartData.length < 2) {
    return <p className="py-4 text-center text-sm text-muted">至少有兩個估值日才會顯示未實現損益趨勢。</p>;
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        持倉未實現損益
        <span className="mt-0.5 block font-normal text-muted sm:ml-2 sm:mt-0 sm:inline">
          （按各日持有部位計算）
        </span>
      </p>
      <ChartFrame className="h-[180px] sm:h-[200px] md:h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis
            tick={amountsHidden ? false : { fontSize: 11 }}
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
                returnRate: number | null;
              };
              if (!row) return ["", ""];
              return [
                `${formatAmount(row.pnl)}${row.returnRate === null ? "" : ` (${formatPercent(row.returnRate)})`}`,
                "未實現損益",
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
      </ChartFrame>
    </div>
  );
}
