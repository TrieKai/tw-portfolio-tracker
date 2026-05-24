"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartRange } from "@/lib/portfolio/calculations";
import {
  filterHistoryByRange,
  formatCurrency,
  getSortedHistory,
} from "@/lib/portfolio/calculations";
import type { PriceHistoryMap } from "@/lib/types/holding";

interface PriceTrendChartProps {
  priceHistory: PriceHistoryMap;
  holdingId: string;
  title: string;
  range: ChartRange;
}

export function PriceTrendChart({
  priceHistory,
  holdingId,
  title,
  range,
}: PriceTrendChartProps) {
  const points = filterHistoryByRange(
    getSortedHistory(priceHistory, holdingId),
    range
  );

  const chartData = points.map((p) => ({
    date: p.date.slice(5),
    price: p.price,
    fullDate: p.date,
  }));

  if (chartData.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
        至少需要 2 個價格點才能繪製趨勢（請先更新價格）
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted)"
            domain={["auto", "auto"]}
            tickFormatter={(v) => String(v)}
          />
          <Tooltip
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.fullDate ?? ""
            }
            formatter={(v) =>
              [formatCurrency(Number(v ?? 0)), "價格"] as [string, string]
            }
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
            }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
