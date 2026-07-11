import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import type { AssetType, HoldingWithMetrics } from "@/lib/types/holding";

export type AssetShockRates = Record<AssetType, number>;

export interface StressTestRow {
  assetType: AssetType;
  currentValue: number;
  stressedValue: number;
  impact: number;
  shockRate: number;
}

export interface StressTestResult {
  currentValue: number;
  stressedValue: number;
  impact: number;
  impactRate: number;
  rows: StressTestRow[];
  shockedHoldingName?: string;
}

/** 純情境試算；不改動持倉，也不把結果寫入價格歷史。 */
export function computeStressTest(
  holdings: HoldingWithMetrics[],
  shocks: AssetShockRates,
  options?: { largestHoldingShock?: number }
): StressTestResult {
  const groups = groupHoldingsWithMetrics(holdings);
  const largest = options?.largestHoldingShock !== undefined
    ? [...groups].sort((a, b) => b.marketValue - a.marketValue)[0]
    : undefined;
  const assetTypes: AssetType[] = ["stock", "fund", "property"];

  const rows = assetTypes.map((assetType) => {
    const relevant = groups.filter((group) => group.assetType === assetType);
    const currentValue = relevant.reduce((sum, group) => sum + group.marketValue, 0);
    let impact = relevant.reduce((sum, group) => {
      const rate = largest?.groupKey === group.groupKey
        ? options?.largestHoldingShock ?? 0
        : shocks[assetType];
      return sum + group.marketValue * (rate / 100);
    }, 0);
    if (Math.abs(impact) < 0.005) impact = 0;
    return {
      assetType,
      currentValue,
      stressedValue: currentValue + impact,
      impact,
      shockRate: largest && relevant.some((group) => group.groupKey === largest.groupKey)
        ? options?.largestHoldingShock ?? 0
        : shocks[assetType],
    };
  });

  const currentValue = rows.reduce((sum, row) => sum + row.currentValue, 0);
  const impact = rows.reduce((sum, row) => sum + row.impact, 0);
  return {
    currentValue,
    stressedValue: currentValue + impact,
    impact,
    impactRate: currentValue > 0 ? (impact / currentValue) * 100 : 0,
    rows,
    shockedHoldingName: largest?.name || largest?.symbol,
  };
}
