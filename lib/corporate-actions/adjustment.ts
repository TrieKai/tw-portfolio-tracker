import type { CorporateActionRecord } from "@/lib/types/holding";

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
