"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/portfolio/calculations";
import {
  buildMonthlyPnlRows,
  hasMonthlyPnlBeforeYtd,
  type MonthlyPnlRow,
} from "@/lib/portfolio/monthly-pnl";
import type { Holding, PriceHistoryMap, SaleTransaction } from "@/lib/types/holding";

function PnlCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted">—</span>;
  }
  return (
    <span
      className={`tabular-nums font-medium ${
        value >= 0 ? "text-gain" : "text-loss"
      }`}
    >
      {formatCurrency(value)}
    </span>
  );
}

function MonthlyPnlRowMobile({ row }: { row: MonthlyPnlRow }) {
  return (
    <li className="glass-card space-y-2 p-4 text-sm">
      <p className="font-medium">{row.monthLabel}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-muted">未實現變化</p>
          <PnlCell value={row.unrealizedChange} />
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">已實現</p>
          <PnlCell value={row.realizedPnl} />
        </div>
      </div>
      {row.saleCount > 0 && (
        <p className="text-xs text-muted">{row.saleCount} 筆賣出</p>
      )}
    </li>
  );
}

export function MonthlyPnlTable({
  holdings,
  priceHistory,
  sales,
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  sales: SaleTransaction[];
}) {
  const [includeBeforeYtd, setIncludeBeforeYtd] = useState(false);

  const canExpandEarlier = useMemo(
    () => hasMonthlyPnlBeforeYtd(holdings, priceHistory, sales),
    [holdings, priceHistory, sales]
  );

  const rows = useMemo(
    () =>
      buildMonthlyPnlRows(holdings, priceHistory, sales, {
        includeBeforeYtd,
      }),
    [holdings, priceHistory, sales, includeBeforeYtd]
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        未實現變化為當月持倉相對月初的損益增減；需有價格歷史方可推算。已實現依賣出日歸屬各月。
      </p>

      {rows.length === 0 ? (
        <p className="text-center text-sm text-muted py-8 glass-card">
          尚無可彙總的月度資料。請先新增持倉，並於
          <a href="/trends" className="text-accent hover:underline mx-1">
            趨勢頁
          </a>
          載入價格歷史或完成賣出紀錄。
        </p>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <MonthlyPnlRowMobile key={row.monthPrefix} row={row} />
            ))}
          </ul>

          <div className="glass-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-3">月份</th>
                  <th className="px-4 py-3">未實現變化</th>
                  <th className="px-4 py-3">已實現</th>
                  <th className="px-4 py-3">賣出</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.monthPrefix}
                    className="border-b border-border/60 hover:bg-surface-raised/50"
                  >
                    <td className="px-4 py-3 font-medium">{row.monthLabel}</td>
                    <td className="px-4 py-3">
                      <PnlCell value={row.unrealizedChange} />
                    </td>
                    <td className="px-4 py-3">
                      <PnlCell value={row.realizedPnl} />
                    </td>
                    <td className="px-4 py-3 text-muted tabular-nums">
                      {row.saleCount > 0 ? `${row.saleCount} 筆` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canExpandEarlier && (
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => setIncludeBeforeYtd((v) => !v)}
        >
          {includeBeforeYtd ? "僅顯示今年" : "顯示更早月份"}
        </button>
      )}
    </div>
  );
}
