/**
 * 投資組合損益與報酬率計算（純函式，可在 client/server 共用）
 */

import { currentYearMonthPrefix } from "@/lib/date/iso-date";
import {
  computeDailyUnrealizedPnlChange,
  computeMonthlyUnrealizedPnlChange,
} from "@/lib/portfolio/monthly-pnl";
import type {
  AssetType,
  Holding,
  HoldingWithMetrics,
  PortfolioSummary,
  PriceHistoryMap,
  PricePoint,
  SaleTransaction,
} from "@/lib/types/holding";
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
  let propertyValue = 0;

  for (const h of holdings) {
    totalCost += h.costBasis;
    totalValue += h.marketValue;
    if (h.assetType === "stock") stockValue += h.marketValue;
    else if (h.assetType === "fund") fundValue += h.marketValue;
    else propertyValue += h.marketValue;
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
  const dailyUnrealizedPnl =
    options?.holdingsForTimeline && options?.priceHistory
      ? computeDailyUnrealizedPnlChange(
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
    dailyUnrealizedPnl,
    saleCount: sales.length,
    stockValue,
    fundValue,
    propertyValue,
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

/** 金額（市值、損益、總資產等）：整數元 */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * 單位報價（現價、買入價、均價、賣價、淨值）
 * - 基金淨值最多 4 位小數；台股等最多 2 位
 */
export function formatQuotePrice(
  n: number,
  assetType: AssetType = "stock"
): string {
  const maxFractionDigits =
    assetType === "fund" ? 4 : assetType === "property" ? 0 : 2;
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n);
}

export function formatPercent(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
