/**
 * 各月未實現變化與已實現損益彙總
 */

import {
  addDaysToIsoDate,
  currentYearMonthPrefix,
  currentYearJanuaryPrefix,
  endDateForMonthPrefix,
  formatYearMonthZh,
  listMonthPrefixesDescending,
  monthPrefixFromIsoDate,
  startOfMonthIsoFromPrefix,
  todayIsoDate,
} from "@/lib/date/iso-date";
import {
  computeMonthlyRealizedPnl,
  countMonthlySales,
} from "@/lib/portfolio/calculations";
import { buildPortfolioTimelineBetween } from "@/lib/portfolio/portfolio-timeline";
import type {
  Holding,
  PriceHistoryMap,
  SaleTransaction,
} from "@/lib/types/holding";

export interface MonthlyPnlRow {
  monthPrefix: string;
  monthLabel: string;
  /** 當月未實現損益變化（月初首個可算日 → 月末或今日） */
  unrealizedChange: number | null;
  realizedPnl: number;
  saleCount: number;
}

/** 區間內未實現損益變化（首尾 timeline pnl 差） */
export function computeUnrealizedPnlChangeForRange(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  startDate: string,
  endDate: string
): number | null {
  if (holdings.length === 0) return null;

  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startDate,
    endDate
  );

  if (points.length === 0) return null;

  const first = points[0];
  const last = points[points.length - 1];
  return last.pnl - first.pnl;
}

/** 今日未實現損益變化（今日相對前一個有報價的交易日） */
export function computeDailyUnrealizedPnlChange(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  asOfDate: string = todayIsoDate()
): number | null {
  if (holdings.length === 0) return null;

  const today = asOfDate;
  const startDate = addDaysToIsoDate(today, -7);
  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startDate,
    today
  );

  if (points.length < 2) return null;

  const last = points[points.length - 1];
  if (last.date !== today) return null;

  const prev = points[points.length - 2];
  return last.pnl - prev.pnl;
}

/** 指定月份未實現損益變化 */
export function computeMonthlyUnrealizedPnlChange(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  monthPrefix: string = currentYearMonthPrefix()
): number | null {
  const startDate = startOfMonthIsoFromPrefix(monthPrefix);
  const endDate = endDateForMonthPrefix(monthPrefix);
  return computeUnrealizedPnlChangeForRange(
    holdings,
    priceHistory,
    startDate,
    endDate
  );
}

function earliestMonthPrefix(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  sales: SaleTransaction[]
): string {
  const candidates: string[] = [currentYearMonthPrefix()];

  for (const s of sales) {
    candidates.push(monthPrefixFromIsoDate(s.sellDate));
  }
  for (const h of holdings) {
    candidates.push(monthPrefixFromIsoDate(h.buyDate));
  }
  for (const points of Object.values(priceHistory)) {
    for (const p of points) {
      candidates.push(monthPrefixFromIsoDate(p.date));
    }
  }

  return candidates.reduce((min, p) => (p < min ? p : min));
}

function monthHasPnlData(row: MonthlyPnlRow): boolean {
  return (
    row.unrealizedChange !== null ||
    row.realizedPnl !== 0 ||
    row.saleCount > 0
  );
}

function buildRow(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  sales: SaleTransaction[],
  monthPrefix: string
): MonthlyPnlRow {
  return {
    monthPrefix,
    monthLabel: formatYearMonthZh(monthPrefix),
    unrealizedChange: computeMonthlyUnrealizedPnlChange(
      holdings,
      priceHistory,
      monthPrefix
    ),
    realizedPnl: computeMonthlyRealizedPnl(sales, monthPrefix),
    saleCount: countMonthlySales(sales, monthPrefix),
  };
}

export interface BuildMonthlyPnlRowsOptions {
  /** 含今年 1 月之前的月份（仍僅列有資料的月份） */
  includeBeforeYtd?: boolean;
  asOfDate?: string;
}

/**
 * 月度損益列（新到舊）。
 * 預設僅今年 YTD 內有資料的月份；展開後含更早月份。
 */
export function buildMonthlyPnlRows(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  sales: SaleTransaction[],
  options?: BuildMonthlyPnlRowsOptions
): MonthlyPnlRow[] {
  const current = options?.asOfDate?.slice(0, 7) ?? currentYearMonthPrefix();
  const earliest = earliestMonthPrefix(holdings, priceHistory, sales);
  const months = listMonthPrefixesDescending(earliest, current);
  const ytdStart = options?.asOfDate
    ? `${options.asOfDate.slice(0, 4)}-01`
    : currentYearJanuaryPrefix();

  const rows = months
    .map((monthPrefix) => buildRow(holdings, priceHistory, sales, monthPrefix))
    .filter(monthHasPnlData);

  if (options?.includeBeforeYtd) {
    return rows;
  }

  return rows.filter((r) => r.monthPrefix >= ytdStart);
}

/** 今年 YTD 之前是否還有可顯示的月份 */
export function hasMonthlyPnlBeforeYtd(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  sales: SaleTransaction[]
): boolean {
  const all = buildMonthlyPnlRows(holdings, priceHistory, sales, {
    includeBeforeYtd: true,
  });
  const ytdStart = currentYearJanuaryPrefix();
  return all.some((r) => r.monthPrefix < ytdStart);
}
