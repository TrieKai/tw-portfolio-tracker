import type {
  AssetAllocationTargets,
  AssetType,
  PortfolioSummary,
} from "@/lib/types/holding";

export interface RebalanceAction {
  assetType: AssetType;
  currentValue: number;
  currentPercent: number;
  targetPercent: number;
  targetValue: number;
  adjustment: number;
}

export interface RebalancePlan {
  totalValue: number;
  plannedTotalValue: number;
  targetTotal: number;
  valid: boolean;
  actions: RebalanceAction[];
}

export const DEFAULT_ALLOCATION_TARGETS: AssetAllocationTargets = {
  stock: 60,
  fund: 30,
  property: 10,
};

/** 計算達到目標配置所需的增持／減持金額，不執行任何交易。 */
export function computeRebalancePlan(
  summary: PortfolioSummary,
  targets: AssetAllocationTargets,
  additionalCash = 0
): RebalancePlan {
  const totalValue = summary.totalValue;
  const plannedTotalValue = Math.max(0, totalValue + Math.max(0, additionalCash));
  const targetTotal = targets.stock + targets.fund + targets.property;
  const valid = Math.abs(targetTotal - 100) < 0.01;
  const values: Record<AssetType, number> = {
    stock: summary.stockValue,
    fund: summary.fundValue,
    property: summary.propertyValue,
  };

  const actions = (["stock", "fund", "property"] as AssetType[]).map((assetType) => {
    const currentValue = values[assetType];
    const targetValue = valid
      ? plannedTotalValue * (targets[assetType] / 100)
      : currentValue;
    return {
      assetType,
      currentValue,
      currentPercent: totalValue > 0 ? (currentValue / totalValue) * 100 : 0,
      targetPercent: targets[assetType],
      targetValue,
      adjustment: targetValue - currentValue,
    };
  });

  return { totalValue, plannedTotalValue, targetTotal, valid, actions };
}
