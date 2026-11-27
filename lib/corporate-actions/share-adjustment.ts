import { corporateActionAdjustmentRatio, costOnDate, holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import { quantityAvailability } from "@/lib/portfolio/quantity";
import type { CorporateActionRecord, Holding, ManualCorporateActionInput, PortfolioStorage } from "@/lib/types/holding";

export function planManualCorporateAction(
  state: Pick<PortfolioStorage, "corporateActions" | "sales">,
  holding: Holding,
  input: Omit<ManualCorporateActionInput, "holdingId">
) {
  const sourceEventId = `manual:${holding.id}:${input.effectiveDate}:${input.actionType}:${input.adjustmentRatio}`;
  return planShareAdjustment(state, holding, { ...input, sourceEventId });
}

export function planShareAdjustment(
  state: Pick<PortfolioStorage, "corporateActions" | "sales">,
  holding: Holding,
  input: Pick<CorporateActionRecord, "effectiveDate" | "sourceEventId" | "cashReturnPerShare"> & { adjustmentRatio: number }
) {
  const { effectiveDate, sourceEventId, adjustmentRatio, cashReturnPerShare = 0 } = input;
  if (holding.assetType !== "stock" || !parseIsoDate(effectiveDate) ||
      effectiveDate > todayIsoDate() || effectiveDate <= holding.buyDate ||
      !Number.isFinite(adjustmentRatio) || adjustmentRatio <= 0 ||
      !Number.isFinite(cashReturnPerShare) || cashReturnPerShare < 0) return null;

  const actions = holdingActions(state.corporateActions, holding);
  if (state.corporateActions.some((action) => action.holdingId === holding.id && action.sourceEventId === sourceEventId)) return null;

  const groupKey = holdingGroupKey(holding);
  const sales = state.sales.filter((sale) => sale.holdingId === holding.id && sale.sellDate >= effectiveDate &&
    holdingGroupKey({ ...sale, id: holding.id }) === groupKey);
  const normalizedSales = sales.map((sale) => ({ ...sale, shares: sale.quantity * shareAdjustmentAfter(actions, sale.sellDate) }));
  const soldSince = (date: string) => normalizedSales.reduce((sum, sale) => sale.sellDate >= date ? sum + sale.shares : sum, 0);
  const sold = soldSince(effectiveDate);
  let laterFactor = shareAdjustmentAfter(actions, effectiveDate);
  // 已成交股數以成交日為準，只把生效日前的部位換成新股數單位。
  const quantityBefore = (holding.quantity + sold) / laterFactor;
  const quantityAfter = quantityBefore * adjustmentRatio;
  const adjustedShares = (holding.quantity + sold) * adjustmentRatio;
  const adjustedBalance = adjustedShares - sold;
  if (!Number.isFinite(quantityAfter) || quantityAfter <= 0 || !Number.isFinite(adjustedBalance)) {
    return { status: "conflict", reason: "amount" } as const;
  }
  const saleStatus = quantityAvailability(sold, adjustedShares);
  if (sold > 0 && !saleStatus) return { status: "conflict", reason: "sale" } as const;
  const balance = saleStatus === "full" ? 0 : adjustedBalance;
  const buyPriceBefore = Math.max(0, costOnDate(holding.buyPrice, actions, effectiveDate));
  const buyPriceAfter = Math.max(0, buyPriceBefore - cashReturnPerShare) / adjustmentRatio;
  const cashReturnTotal = quantityBefore * cashReturnPerShare;
  const terms = {
    quantityBefore, quantityAfter, buyPriceBefore, buyPriceAfter,
    totalCostBefore: buyPriceBefore * quantityBefore,
    totalCostAfter: buyPriceAfter * quantityAfter,
  };

  let currentBuyPrice = buyPriceAfter;
  const laterActions = actions.filter((action) => action.effectiveDate > effectiveDate).sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt)
  );
  const revisedActions = new Map<string, CorporateActionRecord>();
  for (const action of laterActions) {
    const ratio = corporateActionAdjustmentRatio(action);
    const before = (balance + soldSince(action.effectiveDate)) / laterFactor;
    const after = before * ratio;
    const buyPrice = Math.max(0, currentBuyPrice - (action.cashReturnPerShare ?? 0)) / ratio;
    const costBefore = currentBuyPrice * before;
    const costAfter = buyPrice * after;
    if (![before, after, costBefore, costAfter, before * (action.cashReturnPerShare ?? 0)].every(Number.isFinite)) {
      return { status: "conflict", reason: "amount" } as const;
    }
    revisedActions.set(action.id, {
      ...action,
      quantityBefore: before,
      quantityAfter: after,
      buyPriceBefore: currentBuyPrice,
      buyPriceAfter: buyPrice,
      totalCostBefore: action.totalCostBefore === undefined ? undefined : costBefore,
      totalCostAfter: action.totalCostAfter === undefined ? undefined : costAfter,
    });
    currentBuyPrice = buyPrice;
    laterFactor /= ratio;
  }
  if (!Number.isFinite(currentBuyPrice) || !Number.isFinite(cashReturnTotal) ||
      !Number.isFinite(terms.totalCostBefore) || !Number.isFinite(terms.totalCostAfter)) {
    return { status: "conflict", reason: "amount" } as const;
  }

  return {
    status: "ready", holding, terms, sourceEventId, balance, currentBuyPrice, cashReturnTotal, revisedActions, sales,
  } as const;
}

export type ShareAdjustmentPlan = Extract<ReturnType<typeof planShareAdjustment>, { status: "ready" }>;
