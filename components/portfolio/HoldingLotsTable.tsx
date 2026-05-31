"use client";

import { formatCurrency, formatQuotePrice } from "@/lib/portfolio/calculations";
import type { HoldingLotSummary } from "@/lib/portfolio/portfolio-timeline";

export function HoldingLotsTable({ lots }: { lots: HoldingLotSummary[] }) {
  if (lots.length === 0) return null;

  const totalCost = lots.reduce((sum, l) => sum + l.costBasis, 0);

  return (
    <>
      <ul className="space-y-3 md:hidden">
        {lots.map((lot) => (
          <li
            key={lot.holdingId}
            className="rounded-lg border border-border bg-surface px-3 py-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{lot.name}</p>
                <p className="font-mono text-xs text-muted">{lot.symbol}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {lot.assetType === "stock" ? "台股" : "基金"}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">買入日</dt>
              <dd className="text-right tabular-nums">{lot.buyDate}</dd>
              <dt className="text-muted">買入價</dt>
              <dd className="text-right tabular-nums">
                {formatQuotePrice(lot.buyPrice, lot.assetType)}
              </dd>
              <dt className="text-muted">數量</dt>
              <dd className="text-right tabular-nums">{lot.quantity}</dd>
              <dt className="text-muted">投入成本</dt>
              <dd className="text-right font-medium tabular-nums">
                {formatCurrency(lot.costBasis)}
              </dd>
            </dl>
          </li>
        ))}
        <li className="flex justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
          <span className="text-muted">合計投入</span>
          <span className="font-semibold tabular-nums">
            {formatCurrency(totalCost)}
          </span>
        </li>
      </ul>

      <div className="hidden overflow-x-auto md:block">
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
                  {formatQuotePrice(lot.buyPrice, lot.assetType)}
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
                {formatCurrency(totalCost)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
