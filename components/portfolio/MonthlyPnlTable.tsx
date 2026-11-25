"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatFinancingCostImpact } from "@/lib/loans/format";
import { buildMonthlyPerformance, type MonthlyPerformanceRow } from "@/lib/portfolio/monthly-performance";
import type { PortfolioStorage } from "@/lib/types/holding";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

function PnlCell({ value }: { value: number }) {
  const { formatAmount } = useAmountPrivacy();
  return (
    <span
      className={`tabular-nums font-medium ${
        value === 0 ? "text-muted" : value > 0 ? "text-gain" : "text-loss"
      }`}
    >
      {formatAmount(value)}
    </span>
  );
}

function investmentDataLabel(row: MonthlyPerformanceRow) {
  return row.dataDayCount > 0 ? `完整 ${row.completeDayCount}/${row.dataDayCount}` : "僅有融資成本";
}

function MonthlyPnlRowMobile({ row }: { row: MonthlyPerformanceRow }) {
  const { formatAmount, maskAmount } = useAmountPrivacy();
  return (
    <li className="glass-card space-y-2 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{row.monthLabel}</p>
          <p className="mt-1 text-xs text-muted">
            {investmentDataLabel(row)}
          </p>
        </div>
        <div className="text-right">
          <span className="mr-1 text-xs text-muted">扣息後</span>
          <PnlCell value={row.netPnl} />
          <p className="text-xs tabular-nums text-muted">
            投資 {formatAmount(row.investmentPnl)} · 融資成本影響 {maskAmount(formatFinancingCostImpact(row.financingCost))}
          </p>
        </div>
      </div>
    </li>
  );
}

export function MonthlyPnlTable({
  storage,
  asOfDate,
}: {
  storage: PortfolioStorage;
  asOfDate?: string;
}) {
  const { maskAmount } = useAmountPrivacy();
  const [includeEarlierYears, setIncludeEarlierYears] = useState(false);
  const effectiveAsOfDate = asOfDate ?? todayIsoDate();

  const { rows, hasEarlierMonths } = useMemo(
    () => buildMonthlyPerformance(storage, effectiveAsOfDate, includeEarlierYears),
    [storage, effectiveAsOfDate, includeEarlierYears]
  );
  const year = effectiveAsOfDate.slice(0, 4);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        投資損益沿用損益日曆的每日彙總。扣息後淨損益也計入投資用途貸款的利息、費用與對帳調整。
      </p>

      {rows.length === 0 ? (
        <p className="glass-card px-4 py-8 text-center text-sm leading-relaxed text-muted">
          {hasEarlierMonths
            ? `${year} 年目前沒有月度資料，可展開更早月份查看紀錄。`
            : <>目前沒有可彙總的月度資料。已有持倉可到 <Link href="/trends" className="text-accent hover:underline">趨勢頁</Link> 載入歷史價格。</>}
        </p>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <MonthlyPnlRowMobile key={row.monthPrefix} row={row} />
            ))}
          </ul>

          <div className="glass-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-3">月份</th>
                  <th className="px-4 py-3">投資損益</th>
                  <th className="px-4 py-3">融資成本</th>
                  <th className="px-4 py-3">扣息後淨損益</th>
                  <th className="px-4 py-3">投資報酬率</th>
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
                    <td className={`px-4 py-3 tabular-nums ${row.financingCost > 0 ? "text-loss" : row.financingCost < 0 ? "text-gain" : ""}`}>
                      {maskAmount(formatFinancingCostImpact(row.financingCost))}
                    </td>
                    <td className="px-4 py-3">
                      <PnlCell value={row.netPnl} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`tabular-nums ${
                          row.returnRate === null ? "text-muted" : row.returnRate >= 0 ? "text-gain" : "text-loss"
                        }`}
                      >
                        {row.returnRate === null ? "—" : `${row.returnRate > 0 ? "+" : ""}${row.returnRate.toFixed(2)}%`}
                      </span>
                      {row.returnRate !== null && row.returnRateIncomplete && (
                        <span className="ml-1 text-xs text-muted">部分期間</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted tabular-nums">
                      {investmentDataLabel(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hasEarlierMonths && (
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => setIncludeEarlierYears((value) => !value)}
        >
          {includeEarlierYears ? `僅顯示 ${year} 年` : "顯示更早月份"}
        </button>
      )}
    </div>
  );
}
