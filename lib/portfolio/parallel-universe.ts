import type { PricePoint } from "@/lib/types/holding";

export interface UniverseStrategyResult {
  id: "actual" | "dca" | "lumpSum";
  label: string;
  invested: number;
  finalValue: number;
  pnl: number;
  returnRate: number;
}

export interface ParallelUniverseResult {
  startDate: string;
  endDate: string;
  contributionCount: number;
  finalPrice: number;
  maxDrawdown: number;
  strategies: UniverseStrategyResult[];
}

function strategy(
  id: UniverseStrategyResult["id"],
  label: string,
  invested: number,
  finalValue: number
): UniverseStrategyResult {
  const pnl = finalValue - invested;
  return {
    id,
    label,
    invested,
    finalValue,
    pnl,
    returnRate: invested > 0 ? (pnl / invested) * 100 : 0,
  };
}

/** 以每月第一個有效報價日投入，與期初單筆投入及實際持有比較。 */
export function computeParallelUniverse(
  points: PricePoint[],
  options: {
    startDate: string;
    monthlyAmount: number;
    actualCost: number;
    actualQuantity: number;
  }
): ParallelUniverseResult | null {
  const sorted = [...points]
    .filter(
      (point) =>
        point.date >= options.startDate &&
        Number.isFinite(point.price) &&
        point.price > 0
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2 || options.monthlyAmount <= 0) return null;

  const monthlyPoints = new Map<string, PricePoint>();
  for (const point of sorted) {
    const month = point.date.slice(0, 7);
    if (!monthlyPoints.has(month)) monthlyPoints.set(month, point);
  }
  const contributions = [...monthlyPoints.values()];
  if (contributions.length === 0) return null;

  const invested = contributions.length * options.monthlyAmount;
  const dcaUnits = contributions.reduce(
    (sum, point) => sum + options.monthlyAmount / point.price,
    0
  );
  const finalPrice = sorted[sorted.length - 1].price;
  const lumpSumUnits = invested / sorted[0].price;

  let peak = sorted[0].price;
  let maxDrawdown = 0;
  for (const point of sorted) {
    peak = Math.max(peak, point.price);
    maxDrawdown = Math.min(maxDrawdown, ((point.price - peak) / peak) * 100);
  }

  return {
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    contributionCount: contributions.length,
    finalPrice,
    maxDrawdown,
    strategies: [
      strategy(
        "actual",
        "目前實際持有",
        options.actualCost,
        options.actualQuantity * finalPrice
      ),
      strategy("dca", "每月定期定額", invested, dcaUnits * finalPrice),
      strategy("lumpSum", "期初一次投入", invested, lumpSumUnits * finalPrice),
    ],
  };
}
