"use client";

import {
  formatCurrency,
  formatPercent,
  sortSalesByDateDesc,
} from "@/lib/portfolio/calculations";
import type { SaleTransaction } from "@/lib/types/holding";

export function SaleHistoryTable({ sales }: { sales: SaleTransaction[] }) {
  const sorted = sortSalesByDateDesc(sales);

  if (sorted.length === 0) {
    return (
      <p className="text-center text-sm text-muted py-8">
        尚無賣出紀錄。在持倉列表點「賣出」後，已實現損益會記錄於此。
      </p>
    );
  }

  const totalRealized = sorted.reduce((s, t) => s + t.realizedPnl, 0);

  return (
    <div className="space-y-4">
      <p
        className={`text-right text-sm font-medium tabular-nums ${
          totalRealized >= 0 ? "text-gain" : "text-loss"
        }`}
      >
        本頁合計已實現損益：{formatCurrency(totalRealized)}
      </p>

      <ul className="space-y-3 md:hidden">
        {sorted.map((s) => (
          <li key={s.id} className="glass-card space-y-2 p-4 text-sm">
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="font-mono text-xs text-muted">{s.symbol}</p>
              </div>
              <p
                className={`shrink-0 font-semibold tabular-nums ${
                  s.realizedPnl >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {formatCurrency(s.realizedPnl)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted">
              <span>賣出日 {s.sellDate}</span>
              <span className="text-right">
                {s.quantity} × {formatCurrency(s.sellPrice)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="glass-card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="px-4 py-3">賣出日</th>
              <th className="px-4 py-3">標的</th>
              <th className="px-4 py-3">類型</th>
              <th className="px-4 py-3">數量</th>
              <th className="px-4 py-3">賣價</th>
              <th className="px-4 py-3">成交金額</th>
              <th className="px-4 py-3">已實現損益</th>
              <th className="px-4 py-3">報酬率</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const returnRate =
                s.costBasis > 0 ? (s.realizedPnl / s.costBasis) * 100 : 0;
              return (
                <tr
                  key={s.id}
                  className="border-b border-border/60 hover:bg-surface-raised/50"
                >
                  <td className="px-4 py-3 tabular-nums">{s.sellDate}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.name}</div>
                    <div className="font-mono text-xs text-muted">
                      {s.symbol}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {s.assetType === "stock" ? "台股" : "基金"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.quantity}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCurrency(s.sellPrice)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatCurrency(s.proceeds)}
                  </td>
                  <td
                    className={`px-4 py-3 tabular-nums font-medium ${
                      s.realizedPnl >= 0 ? "text-gain" : "text-loss"
                    }`}
                  >
                    {formatCurrency(s.realizedPnl)}
                  </td>
                  <td
                    className={`px-4 py-3 tabular-nums ${
                      returnRate >= 0 ? "text-gain" : "text-loss"
                    }`}
                  >
                    {formatPercent(returnRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
