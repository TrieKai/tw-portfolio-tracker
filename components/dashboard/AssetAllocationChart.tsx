"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type { PortfolioSummary } from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";

const COLORS = ["#10b981", "#3b82f6", "#f59e0b"];

export function AssetAllocationChart({
  summary,
  view = "standard",
}: {
  summary: PortfolioSummary;
  view?: DashboardCardView;
}) {
  const data = [
    { name: "台股", value: summary.stockValue },
    { name: "基金", value: summary.fundValue },
    { name: "房子", value: summary.propertyValue },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="glass-card flex h-64 items-center justify-center text-sm text-muted">
        尚無資產資料
      </div>
    );
  }

  if (view === "compact") {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    return (
      <div className="glass-card h-full p-5">
        <h2 className="mb-4 text-sm font-medium text-muted">資產配置</h2>
        <div className="space-y-4">
          {data.map((item, index) => (
            <div key={item.name}>
              <div className="mb-1.5 flex justify-between gap-3 text-xs">
                <span>{item.name}</span>
                <span className="tabular-nums text-muted">{((item.value / total) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
                <div className="h-full rounded-full" style={{ width: `${(item.value / total) * 100}%`, backgroundColor: COLORS[index] }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h2 className="mb-4 text-sm font-medium text-muted">資產配置</h2>
      <div className={`${view === "visual" ? "h-[240px] sm:h-[280px]" : "h-[200px] sm:h-[240px]"} w-full min-w-0`}>
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
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => formatCurrency(Number(v ?? 0))}
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
