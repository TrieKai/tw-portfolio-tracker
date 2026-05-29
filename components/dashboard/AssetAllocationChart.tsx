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

const COLORS = ["#10b981", "#3b82f6"];

export function AssetAllocationChart({
  summary,
}: {
  summary: PortfolioSummary;
}) {
  const data = [
    { name: "台股", value: summary.stockValue },
    { name: "基金", value: summary.fundValue },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="glass-card flex h-64 items-center justify-center text-sm text-muted">
        尚無資產資料
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h2 className="mb-4 text-sm font-medium text-muted">資產配置</h2>
      <div className="h-[200px] w-full min-w-0 sm:h-[240px]">
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
