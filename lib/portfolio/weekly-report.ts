import { addDaysToIsoDate } from "@/lib/date/iso-date";
import { computePortfolioSummary, enrichHoldings } from "@/lib/portfolio/calculations";
import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import type { AssetType, PortfolioStorage } from "@/lib/types/holding";

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

/** 以最近有持倉、交易或估值紀錄的日期為期末，各日採當時的部位與行情。 */
export function buildWeeklyPortfolioReport(
  storage: PortfolioStorage,
  asOfDate: string,
  portfolioHistory = buildPortfolioHistory(storage)
): WeeklyPortfolioReport | null {
  const dates = portfolioHistory.dates.filter((date) => date <= asOfDate);
  if (dates.length < 2) return null;
  const endDate = dates[dates.length - 1];
  const preferredStart = addDaysToIsoDate(endDate, -7);
  const startDate = dates.findLast((date) => date <= preferredStart) ?? dates[0];
  const startHoldings = enrichHoldings(portfolioHistory.snapshotOn(startDate));
  const endHoldings = enrichHoldings(portfolioHistory.snapshotOn(endDate));
  const start = computePortfolioSummary(startHoldings, []);
  const end = computePortfolioSummary(endHoldings, []);

  const contributionMap = new Map<string, WeeklyContribution>();
  for (const group of groupHoldingsWithMetrics(startHoldings)) {
    const { groupKey, name, symbol, pnl } = group;
    contributionMap.set(groupKey, { groupKey, name, symbol, amount: -pnl });
  }
  for (const group of groupHoldingsWithMetrics(endHoldings)) {
    const { groupKey, name, symbol, pnl } = group;
    contributionMap.set(groupKey, {
      groupKey, name, symbol, amount: pnl + (contributionMap.get(groupKey)?.amount ?? 0),
    });
  }
  const contributions = [...contributionMap.values()];
  const topPositive = contributions
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0];
  const topNegative = contributions
    .filter((item) => item.amount < 0)
    .sort((a, b) => a.amount - b.amount)[0];

  const realizedPnl = storage.sales
    .filter((sale) => sale.sellDate > startDate && sale.sellDate <= endDate)
    .reduce((sum, sale) => sum + sale.realizedPnl, 0);
  // 房產直接登錄於持倉，股票與基金則以買入事件計算，避免賣出抵銷買入金額。
  const newCapital = storage.transactions
    .filter((event) => event.type === "buy" && event.date > startDate && event.date <= endDate)
    .reduce((sum, event) => sum + (event.quantity ?? 0) * (event.price ?? 0), 0) +
    portfolioHistory.initialLots
      .filter((lot) => lot.assetType === "property" && lot.buyDate > startDate && lot.buyDate <= endDate)
      .reduce((sum, lot) => sum + lot.quantity * lot.buyPrice, 0);

  let largestAllocationDrift: WeeklyPortfolioReport["largestAllocationDrift"];
  const targets = storage.settings.allocationTargets;
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
    unrealizedChange: end.totalPnl - start.totalPnl,
    realizedPnl,
    newCapital,
    topPositive,
    topNegative,
    largestAllocationDrift,
  };
}
