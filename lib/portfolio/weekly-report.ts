import { addDaysToIsoDate } from "@/lib/date/iso-date";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import {
  buildPortfolioTimelineBetween,
  getEffectiveHistory,
  getUnitPriceOnDate,
} from "@/lib/portfolio/portfolio-timeline";
import type {
  AssetAllocationTargets,
  AssetType,
  Holding,
  PriceHistoryMap,
  SaleTransaction,
} from "@/lib/types/holding";

export interface WeeklyContribution {
  groupKey: string;
  name: string;
  symbol: string;
  amount: number;
}

export interface WeeklyPortfolioReport {
  startDate: string;
  endDate: string;
  usesPreviousDate: boolean;
  startValue: number;
  endValue: number;
  valueChange: number;
  unrealizedChange: number;
  realizedPnl: number;
  newCapital: number;
  topPositive?: WeeklyContribution;
  topNegative?: WeeklyContribution;
  largestAllocationDrift?: {
    assetType: AssetType;
    currentPercent: number;
    targetPercent: number;
    difference: number;
  };
}

/** 最近約七天週報；截止日取實際行情日，因此休市時仍可產生。 */
export function buildWeeklyPortfolioReport(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  sales: SaleTransaction[],
  asOfDate: string,
  targets?: AssetAllocationTargets
): WeeklyPortfolioReport | null {
  if (holdings.length === 0) return null;

  const quoteDates = [...new Set(
    holdings.flatMap((holding) =>
      getEffectiveHistory(holding, priceHistory)
        .filter((point) => point.date <= asOfDate)
        .map((point) => point.date)
    )
  )].sort();
  if (quoteDates.length < 2) return null;

  const endDate = quoteDates[quoteDates.length - 1];
  const preferredStart = addDaysToIsoDate(endDate, -7);
  const earlierDates = quoteDates.filter((date) => date < endDate);
  const startDate =
    [...earlierDates].reverse().find((date) => date <= preferredStart) ??
    earlierDates[0];
  if (!startDate) return null;

  const timeline = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startDate,
    endDate
  );
  const start = timeline.find((point) => point.date === startDate);
  const end = timeline.find((point) => point.date === endDate);
  if (!start || !end) return null;

  const contributionMap = new Map<string, WeeklyContribution>();
  for (const holding of holdings) {
    if (holding.buyDate > endDate) continue;
    const history = getEffectiveHistory(holding, priceHistory);
    const endPrice = getUnitPriceOnDate(holding, history, endDate).unitPrice;
    const startPrice = holding.buyDate > startDate
      ? holding.buyPrice
      : getUnitPriceOnDate(holding, history, startDate).unitPrice;
    const amount = (endPrice - startPrice) * holding.quantity;
    const key = holdingGroupKey(holding);
    const existing = contributionMap.get(key);
    if (existing) existing.amount += amount;
    else contributionMap.set(key, {
      groupKey: key,
      name: holding.name,
      symbol: holding.symbol,
      amount,
    });
  }
  const contributions = [...contributionMap.values()];
  const topPositive = contributions
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0];
  const topNegative = contributions
    .filter((item) => item.amount < 0)
    .sort((a, b) => a.amount - b.amount)[0];

  const realizedPnl = sales
    .filter((sale) => sale.sellDate > startDate && sale.sellDate <= endDate)
    .reduce((sum, sale) => sum + sale.realizedPnl, 0);

  let largestAllocationDrift: WeeklyPortfolioReport["largestAllocationDrift"];
  if (targets && end.totalValue > 0) {
    const values: Record<AssetType, number> = {
      stock: end.stockValue,
      fund: end.fundValue,
      property: end.propertyValue,
    };
    largestAllocationDrift = (["stock", "fund", "property"] as AssetType[])
      .map((assetType) => {
        const currentPercent = (values[assetType] / end.totalValue) * 100;
        return {
          assetType,
          currentPercent,
          targetPercent: targets[assetType],
          difference: currentPercent - targets[assetType],
        };
      })
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0];
  }

  return {
    startDate,
    endDate,
    usesPreviousDate: endDate < asOfDate,
    startValue: start.totalValue,
    endValue: end.totalValue,
    valueChange: end.totalValue - start.totalValue,
    unrealizedChange: end.pnl - start.pnl,
    realizedPnl,
    newCapital: Math.max(0, end.totalCost - start.totalCost),
    topPositive,
    topNegative,
    largestAllocationDrift,
  };
}
