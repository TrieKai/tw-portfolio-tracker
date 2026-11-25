import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { CorporateActionRecord, Holding } from "@/lib/types/holding";

export function corporateActionAdjustmentRatio(action: CorporateActionRecord): number {
  if (
    action.adjustmentRatio !== undefined &&
    Number.isFinite(action.adjustmentRatio) &&
    action.adjustmentRatio > 0
  ) {
    return action.adjustmentRatio;
  }

  if (
    action.stockDividendRatio !== undefined &&
    Number.isFinite(action.stockDividendRatio) &&
    action.stockDividendRatio > 0
  ) {
    return 1 + action.stockDividendRatio;
  }

  return 1;
}

/** 指定日的原始股數換成資料中已套用公司行動後的股數。 */
export function shareAdjustmentAfter(actions: CorporateActionRecord[], date: string): number {
  return actions.reduce((factor, action) =>
    date < action.effectiveDate ? factor * corporateActionAdjustmentRatio(action) : factor, 1
  );
}

/** 由目前成本回推成交日的每股成本，保留成本更正的差額。 */
export function costOnDate(cost: number, actions: CorporateActionRecord[], date: string): number {
  return actionsAfter(actions, date).reverse().reduce((price, action) =>
    action.buyPriceBefore + (price - action.buyPriceAfter) * corporateActionAdjustmentRatio(action), cost
  );
}

/** 由成交日成本換成目前股數基準，供已出清的持倉回推使用。 */
export function costInCurrentUnits(cost: number, actions: CorporateActionRecord[], date: string): number {
  return actionsAfter(actions, date).reduce((price, action) =>
    action.buyPriceAfter + (price - action.buyPriceBefore) / corporateActionAdjustmentRatio(action), cost
  );
}

function actionsAfter(actions: CorporateActionRecord[], date: string) {
  return actions.filter((action) => date < action.effectiveDate).sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt)
  );
}

export function holdingActions(
  actions: CorporateActionRecord[],
  holding: Pick<Holding, "id" | "assetType" | "symbol" | "market">
): CorporateActionRecord[] {
  const key = holdingGroupKey(holding);
  return actions.filter((action) =>
    action.holdingId === holding.id && holdingGroupKey({ ...action, id: holding.id }) === key
  );
}

/** 補登以成交日股數為準，已登錄的後續成交已從可賣數量扣除。 */
export function holdingSaleTerms(holding: Holding, actions: CorporateActionRecord[], date: string) {
  const applicable = holdingActions(actions, holding);
  const shareFactor = shareAdjustmentAfter(applicable, date);
  return {
    shareFactor,
    buyPrice: Math.max(0, costOnDate(holding.buyPrice, applicable, date)),
    quantity: date < holding.buyDate ? 0 : holding.quantity / shareFactor,
  };
}
