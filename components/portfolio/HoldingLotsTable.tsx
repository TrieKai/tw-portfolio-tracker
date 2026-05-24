"use client";

import { formatCurrency } from "@/lib/portfolio/calculations";
import type { HoldingLotSummary } from "@/lib/portfolio/portfolio-timeline";

export function HoldingLotsTable({ lots }: { lots: HoldingLotSummary[] }) {
  if (lots.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="px-3 py-2">標的</th>
            <th className="px-3 py-2">類型</th>
            <th className="px-3 py-2">買入日</th>
            <th className="px-3 py-2">買入價</th>
            <th className="px-3 py-2">數量</th>
            <th className="px-3 py-2">投入成本</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr
              key={lot.holdingId}
              className="border-b border-border/60 hover:bg-surface-raised/50"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{lot.name}</div>
                <div className="font-mono text-xs text-muted">{lot.symbol}</div>
              </td>
              <td className="px-3 py-2 text-muted">
                {lot.assetType === "stock" ? "台股" : "基金"}
              </td>
              <td className="px-3 py-2 tabular-nums">{lot.buyDate}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatCurrency(lot.buyPrice)}
              </td>
              <td className="px-3 py-2 tabular-nums">{lot.quantity}</td>
              <td className="px-3 py-2 tabular-nums font-medium">
                {formatCurrency(lot.costBasis)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-muted">
            <td colSpan={5} className="px-3 py-2 text-right">
              合計投入
            </td>
            <td className="px-3 py-2 tabular-nums font-semibold text-foreground">
              {formatCurrency(
                lots.reduce((sum, l) => sum + l.costBasis, 0)
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
