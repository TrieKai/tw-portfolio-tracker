"use client";

import { useMemo } from "react";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { filterHistoryByRange, type ChartRange } from "@/lib/portfolio/calculations";
import type { HoldingSymbolGroup } from "@/lib/portfolio/holding-groups";
import { buildInstrumentPriceHistory } from "@/lib/portfolio/price-history";
import type { CorporateActionRecord, PriceHistoryMap } from "@/lib/types/holding";
import { ChartFrame } from "@/components/ui/ChartFrame";
import { historyDateAxis } from "./chart-axes";

interface PriceTrendChartProps {
  priceHistory: PriceHistoryMap;
  group: HoldingSymbolGroup;
  corporateActions: CorporateActionRecord[];
  title: string;
  range: ChartRange;
}

export function PriceTrendChart({
  priceHistory,
  group,
  corporateActions,
  title,
  range,
}: PriceTrendChartProps) {
  const { formatQuoteAmount, amountsHidden } = useAmountPrivacy();
  const history = useMemo(
    () => buildInstrumentPriceHistory(group, priceHistory, corporateActions),
    [group, priceHistory, corporateActions]
  );
  const points = filterHistoryByRange(history.points, range);

  const chartData = points.map((p) => ({
    date: p.date,
    timestamp: Date.parse(p.date),
    price: p.price,
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
      <p className="text-sm font-medium">{title}</p>
      <p className="mb-3 mt-1 text-xs text-muted">
        可用價格 {chartData[0].date}～{chartData.at(-1)?.date} · {chartData.length} 筆
        {history.lastShareChange && chartData[0].date < history.lastShareChange ? (
          <span className="mt-1 block">股數異動前的價格已換算為目前股數基準。</span>
        ) : null}
      </p>
      <ChartFrame className="h-[200px] sm:h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis {...historyDateAxis(chartData[0].date, chartData[chartData.length - 1].date)} />
          <YAxis
            tick={amountsHidden ? false : { fontSize: 11 }}
            stroke="var(--muted)"
            domain={["auto", "auto"]}
            tickFormatter={(v) => String(v)}
          />
          <Tooltip
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.date ?? ""
            }
            formatter={(v) =>
              [
                formatQuoteAmount(Number(v ?? 0), group.assetType),
                "價格",
              ] as [string, string]
            }
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
            }}
          />
          <Line
            type="linear"
            dataKey="price"
            stroke="#10b981"
            strokeWidth={2}
            dot={chartData.length <= 40}
          />
        </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
