/**
 * 投資組合損益與報酬率計算（純函式，可在 client/server 共用）
 */

import {
  currentYearMonthPrefix,
  startOfMonthIso,
  todayIsoDate,
} from "@/lib/date/iso-date";
import type {
  Holding,
  HoldingWithMetrics,
  PortfolioSummary,
  PriceHistoryMap,
  PricePoint,
  SaleTransaction,
} from "@/lib/types/holding";
import { buildPortfolioTimelineBetween } from "./portfolio-timeline";
import {
  chartRangeToIsoDates,
  type ChartRange,
} from "./chart-date-range";

export type { ChartRange } from "./chart-date-range";
export { CHART_RANGE_OPTIONS } from "./chart-date-range";

export function computeHoldingMetrics(holding: Holding): HoldingWithMetrics {
  const costBasis = holding.buyPrice * holding.quantity;
  const hasLivePrice =
    holding.currentPrice !== undefined && holding.currentPrice > 0;
  const marketValue = hasLivePrice
    ? holding.currentPrice! * holding.quantity
    : costBasis;
  const pnl = hasLivePrice ? marketValue - costBasis : 0;
  const returnRate =
    costBasis > 0 && hasLivePrice ? (pnl / costBasis) * 100 : 0;

  return {
    ...holding,
    costBasis,
    marketValue,
    pnl,
    returnRate,
    hasLivePrice,
  };
}

export function computeTotalRealizedPnl(sales: SaleTransaction[]): number {
  return sales.reduce((sum, s) => sum + s.realizedPnl, 0);
}

/** 本月已實現損益（依 sellDate 落在當月） */
export function computeMonthlyRealizedPnl(
  sales: SaleTransaction[],
  monthPrefix: string = currentYearMonthPrefix()
): number {
  return sales
    .filter((s) => s.sellDate.startsWith(monthPrefix))
    .reduce((sum, s) => sum + s.realizedPnl, 0);
}

export function countMonthlySales(
  sales: SaleTransaction[],
  monthPrefix: string = currentYearMonthPrefix()
): number {
  return sales.filter((s) => s.sellDate.startsWith(monthPrefix)).length;
}

/**
 * 本月未實現損益變化：區間內最後一日與第一日的 total pnl 差值。
 * 需有價格歷史或現價才能推算；無資料點時回傳 null。
 */
export function computeMonthlyUnrealizedPnlChange(
  holdings: Holding[],
  priceHistory: PriceHistoryMap
): number | null {
  if (holdings.length === 0) return null;

  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startOfMonthIso(),
    todayIsoDate()
  );

  if (points.length === 0) return null;

  const first = points[0];
  const last = points[points.length - 1];
  return last.pnl - first.pnl;
}

/** 依賣出日期新到舊排序 */
export function sortSalesByDateDesc(sales: SaleTransaction[]): SaleTransaction[] {
  return [...sales].sort((a, b) => {
    const byDate = b.sellDate.localeCompare(a.sellDate);
    if (byDate !== 0) return byDate;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function computePortfolioSummary(
  holdings: HoldingWithMetrics[],
  sales: SaleTransaction[] = [],
  options?: {
    holdingsForTimeline?: Holding[];
    priceHistory?: PriceHistoryMap;
  }
): PortfolioSummary {
  let totalCost = 0;
  let totalValue = 0;
  let stockValue = 0;
  let fundValue = 0;

  for (const h of holdings) {
    totalCost += h.costBasis;
    totalValue += h.marketValue;
    if (h.assetType === "stock") stockValue += h.marketValue;
    else fundValue += h.marketValue;
  }

  const totalPnl = totalValue - totalCost;
  const totalReturnRate =
    totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const totalRealizedPnl = computeTotalRealizedPnl(sales);
  const monthlyRealizedPnl = computeMonthlyRealizedPnl(sales);
  const monthlySaleCount = countMonthlySales(sales);
  const monthlyUnrealizedPnl =
    options?.holdingsForTimeline && options?.priceHistory
      ? computeMonthlyUnrealizedPnlChange(
          options.holdingsForTimeline,
          options.priceHistory
        )
      : null;

  return {
    totalCost,
    totalValue,
    totalPnl,
    totalReturnRate,
    totalRealizedPnl,
    monthlyRealizedPnl,
    monthlySaleCount,
    monthlyUnrealizedPnl,
    saleCount: sales.length,
    stockValue,
    fundValue,
    holdingCount: holdings.length,
  };
}

export function enrichHoldings(holdings: Holding[]): HoldingWithMetrics[] {
  return holdings.map(computeHoldingMetrics);
}

/** 依日期升冪排序的價格序列 */
export function getSortedHistory(
  priceHistory: PriceHistoryMap,
  holdingId: string
): PricePoint[] {
  const points = priceHistory[holdingId] ?? [];
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

export function filterHistoryByRange(
  points: PricePoint[],
  range: ChartRange
): PricePoint[] {
  if (range === "all" || points.length === 0) return points;
  const { startDate } = chartRangeToIsoDates(range);
  return points.filter((p) => p.date >= startDate);
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatPercent(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
