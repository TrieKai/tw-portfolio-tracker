/**
 * 各月未實現變化與已實現損益彙總
 */

import {
  currentYearMonthPrefix,
  endDateForMonthPrefix,
  startOfMonthIsoFromPrefix,
  todayIsoDate,
} from "@/lib/date/iso-date";
import { getLatestDailyValuation } from "@/lib/portfolio/daily-valuation";
import { buildPortfolioTimelineBetween } from "@/lib/portfolio/portfolio-timeline";
import type {
  Holding,
  PriceHistoryMap,
} from "@/lib/types/holding";

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

/** 最近估值日未實現損益變化（相對前一個有效估值日） */
export function computeDailyUnrealizedPnlChange(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  asOfDate: string = todayIsoDate()
): number | null {
  return getLatestDailyValuation(holdings, priceHistory, asOfDate)?.pnlChange ?? null;
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
