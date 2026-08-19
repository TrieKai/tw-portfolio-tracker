"use client";

import { useMemo, useState } from "react";
import { endDateForMonthPrefix, todayIsoDate } from "@/lib/date/iso-date";
import { formatCurrency } from "@/lib/portfolio/calculations";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import {
  buildMonthlyPnlRows,
  hasMonthlyPnlBeforeYtd,
  type MonthlyPnlRow,
} from "@/lib/portfolio/monthly-pnl";
import type {
  Holding,
  PortfolioStorage,
  PriceHistoryMap,
  SaleTransaction,
} from "@/lib/types/holding";

interface CalendarMonthlyPnlRow extends MonthlyPnlRow {
  investmentPnl: number;
  returnRate: number;
  dataDayCount: number;
  completeDayCount: number;
}

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

function MonthlyPnlRowMobile({ row }: { row: CalendarMonthlyPnlRow }) {
  return (
    <li className="glass-card space-y-2 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{row.monthLabel}</p>
          <p className="mt-1 text-xs text-muted">
            {row.dataDayCount} 個資料日 · 完整 {row.completeDayCount}/
            {row.dataDayCount}
          </p>
        </div>
        <div className="text-right">
          <PnlCell value={row.investmentPnl} />
          <p
            className={`text-xs tabular-nums ${
              row.returnRate >= 0 ? "text-gain" : "text-loss"
            }`}
          >
            {row.returnRate > 0 ? "+" : ""}
            {row.returnRate.toFixed(2)}%
          </p>
        </div>
      </div>
    </li>
  );
}

export function MonthlyPnlTable({
  holdings,
  priceHistory,
  sales,
  storage,
  asOfDate,
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  sales: SaleTransaction[];
  storage: PortfolioStorage;
  asOfDate?: string;
}) {
  const [includeBeforeYtd, setIncludeBeforeYtd] = useState(false);
  const effectiveAsOfDate = asOfDate ?? todayIsoDate();

  const canExpandEarlier = useMemo(
    () => hasMonthlyPnlBeforeYtd(holdings, priceHistory, sales),
    [holdings, priceHistory, sales]
  );

  const rows = useMemo(() => {
    const baseRows = buildMonthlyPnlRows(holdings, priceHistory, sales, {
        includeBeforeYtd,
        asOfDate: effectiveAsOfDate,
      });

    return baseRows.map((row): CalendarMonthlyPnlRow => {
      const calendar = buildPnlCalendar(storage, {
        month: row.monthPrefix,
        asOfDate:
          row.monthPrefix === effectiveAsOfDate.slice(0, 7)
            ? effectiveAsOfDate
            : endDateForMonthPrefix(row.monthPrefix),
        filter: { kind: "investment" },
      });
      return {
        ...row,
        investmentPnl: calendar.summary.pnl,
        returnRate: calendar.summary.returnRate,
        dataDayCount: calendar.summary.dataDayCount,
        completeDayCount: calendar.summary.completeDayCount,
      };
    });
  }, [
    holdings,
    priceHistory,
    sales,
    storage,
    includeBeforeYtd,
    effectiveAsOfDate,
  ]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        依每日估值變動、買賣價差、股利及費稅彙總；買賣本金與減資退現金不列為投資損益。
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
                  <th className="px-4 py-3">投資損益</th>
                  <th className="px-4 py-3">報酬率</th>
                  <th className="px-4 py-3">資料品質</th>
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
                      <PnlCell value={row.investmentPnl} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`tabular-nums ${
                          row.returnRate >= 0 ? "text-gain" : "text-loss"
                        }`}
                      >
                        {row.returnRate > 0 ? "+" : ""}
                        {row.returnRate.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted tabular-nums">
                      {row.dataDayCount > 0
                        ? `完整 ${row.completeDayCount}/${row.dataDayCount}`
                        : "尚無每日資料"}
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
