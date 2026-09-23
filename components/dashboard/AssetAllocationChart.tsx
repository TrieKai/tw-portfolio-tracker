"use client";

import { useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type {
  HoldingWithMetrics,
  PortfolioSummary,
} from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";
import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

const TYPE_COLORS = ["#10b981", "#3b82f6", "#f59e0b"];
const HOLDING_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#64748b",
];
const MAX_VISIBLE_HOLDINGS = 6;

type AllocationMode = "type" | "holding";

interface AllocationItem {
  key: string;
  name: string;
  symbol?: string;
  value: number;
  color: string;
}

function buildTypeAllocation(summary: PortfolioSummary): AllocationItem[] {
  return [
    { key: "stock", name: "台股", value: summary.stockValue, color: TYPE_COLORS[0] },
    { key: "fund", name: "基金", value: summary.fundValue, color: TYPE_COLORS[1] },
    { key: "property", name: "房子", value: summary.propertyValue, color: TYPE_COLORS[2] },
  ].filter((item) => item.value > 0);
}

function buildHoldingAllocation(holdings: HoldingWithMetrics[]): AllocationItem[] {
  const groups = groupHoldingsWithMetrics(holdings)
    .filter((group) => group.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue);
  const visible = groups.slice(0, MAX_VISIBLE_HOLDINGS);
  const otherValue = groups
    .slice(MAX_VISIBLE_HOLDINGS)
    .reduce((sum, group) => sum + group.marketValue, 0);

  const items: AllocationItem[] = visible.map((group, index) => ({
    key: group.groupKey,
    name: group.name,
    symbol: group.symbol.trim() || undefined,
    value: group.marketValue,
    color: HOLDING_COLORS[index] ?? HOLDING_COLORS[0],
  }));

  if (otherValue > 0) {
    items.push({
      key: "other",
      name: "其他",
      value: otherValue,
      color: HOLDING_COLORS[HOLDING_COLORS.length - 1],
    });
  }

  return items;
}

function AllocationModeToggle({
  mode,
  onChange,
}: {
  mode: AllocationMode;
  onChange: (nextMode: AllocationMode) => void;
}) {
  return (
    <div
      className="mb-4 inline-flex max-w-full rounded-lg bg-surface-raised p-1"
      role="tablist"
      aria-label="資產配置檢視方式"
    >
      {([
        ["type", "資產類型"],
        ["holding", "個別標的"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={`touch-target rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AllocationLegend({
  data,
  mode,
}: {
  data: AllocationItem[];
  mode: AllocationMode;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const gridClass = mode === "type" ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <ul
      className={`mt-2 grid gap-2 text-sm ${gridClass}`}
      aria-label="資產配置比例"
    >
      {data.map((item) => (
        <li
          key={item.key}
          className="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-surface-raised/60 px-3 py-2"
        >
          <span className="flex min-w-0 items-start gap-2">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              {item.symbol && (
                <span className="block truncate text-xs text-muted">
                  {item.symbol}
                </span>
              )}
            </span>
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {((item.value / total) * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AssetAllocationChart({
  summary,
  holdings = [],
  view = "standard",
}: {
  summary: PortfolioSummary;
  /** 用於個別標的模式；多筆同標的買入會合併，房子則每筆獨立。 */
  holdings?: HoldingWithMetrics[];
  view?: DashboardCardView;
}) {
  const { formatAmount } = useAmountPrivacy();
  const [mode, setMode] = useState<AllocationMode>("type");
  const typeData = useMemo(() => buildTypeAllocation(summary), [summary]);
  const holdingData = useMemo(
    () => buildHoldingAllocation(holdings),
    [holdings]
  );
  const data = mode === "type" ? typeData : holdingData;
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (data.length === 0) {
    return (
      <div className="glass-card flex h-64 items-center justify-center text-sm text-muted">
        尚無資產資料
      </div>
    );
  }

  if (view === "compact") {
    return (
      <div className="glass-card h-full p-5">
        <h2 className="mb-3 text-sm font-medium text-muted">資產配置</h2>
        <AllocationModeToggle mode={mode} onChange={setMode} />
        <div className="space-y-4">
          {data.map((item) => (
            <div key={item.key}>
              <div className="mb-1.5 flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">
                  {item.name}
                  {item.symbol && (
                    <span className="ml-1 text-muted">({item.symbol})</span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {((item.value / total) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.value / total) * 100}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h2 className="mb-3 text-sm font-medium text-muted">資產配置</h2>
      <AllocationModeToggle mode={mode} onChange={setMode} />
      <div
        className={`${
          view === "visual" ? "h-[210px] sm:h-[250px]" : "h-[190px] sm:h-[220px]"
        } w-full min-w-0`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="70%"
              paddingAngle={2}
              labelLine={false}
              label={({ percent }) => {
                const ratio = Number(percent ?? 0);
                return ratio >= 0.05 ? `${(ratio * 100).toFixed(0)}%` : "";
              }}
            >
              {data.map((item) => (
                <Cell key={item.key} fill={item.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatAmount(Number(value ?? 0))}
              contentStyle={{
                background: "var(--tooltip-bg)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <AllocationLegend data={data} mode={mode} />
    </div>
  );
}
