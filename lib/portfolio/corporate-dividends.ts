import { corporateActionAdjustmentRatio } from "@/lib/corporate-actions/adjustment";
import { dividendShareCount, listDividendLots } from "@/lib/portfolio/dividend-lots";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { PortfolioStorage, PortfolioTransaction } from "@/lib/types/holding";

export function reconcileCorporateDividends(state: PortfolioStorage, holdingId?: string) {
  const candidates = state.transactions.filter((event) =>
    event.type === "cash_dividend" && event.source === "corporate_action" &&
    (!holdingId || event.holdingId === holdingId)
  );
  if (!candidates.length) return { storage: state, dates: [] as string[] };

  const byDate = new Map<string, PortfolioTransaction[]>();
  for (const event of candidates) {
    const key = `${event.holdingId}:${event.date}`;
    const records = byDate.get(key) ?? [];
    records.push(event);
    byDate.set(key, records);
  }
  const lots = new Map(listDividendLots(state).map((lot) => [lot.id, lot]));
  const manual = new Set(state.transactions
    .filter((event) => event.type === "cash_dividend" && event.source === "user")
    .map((event) => JSON.stringify([event.holdingId, event.date, event.amount])));
  const changed = new Map<string, PortfolioTransaction>();
  const dropped = new Set<string>();
  const dates = new Set<string>();
  const corporateActions = state.corporateActions.map((action) => {
    if (!action.cashDividend || (holdingId && action.holdingId !== holdingId)) return action;
    const records = byDate.get(`${action.holdingId}:${action.effectiveDate}`) ?? [];
    const linked = records.filter((event) => event.corporateActionEventId === action.sourceEventId);
    const dividend = linked[0] ?? records.find((event) =>
      !event.corporateActionEventId && event.createdAt === action.createdAt
    );
    if (!dividend) return action;
    const lot = lots.get(action.holdingId);
    if (!lot || holdingGroupKey(lot) !== holdingGroupKey({ ...action, id: lot.id })) return action;
    const quantity = dividendShareCount(state, lot, action.effectiveDate);
    if (quantity === null) return action;

    const amount = quantity * action.cashDividend;
    if (manual.has(JSON.stringify([lot.id, action.effectiveDate, amount]))) {
      dropped.add(dividend.id);
      dates.add(action.effectiveDate);
    } else if (amount !== dividend.amount || !dividend.corporateActionEventId) {
      changed.set(dividend.id, { ...dividend, amount, corporateActionEventId: action.sourceEventId });
      dates.add(action.effectiveDate);
    }
    for (const duplicate of linked.slice(1)) {
      dropped.add(duplicate.id);
      dates.add(action.effectiveDate);
    }
    if (quantity === action.quantityBefore) return action;
    const quantityAfter = quantity * corporateActionAdjustmentRatio(action);
    dates.add(action.effectiveDate);
    return {
      ...action,
      quantityBefore: quantity,
      quantityAfter,
      totalCostBefore: action.totalCostBefore === undefined ? undefined : action.buyPriceBefore * quantity,
      totalCostAfter: action.totalCostAfter === undefined ? undefined : action.buyPriceAfter * quantityAfter,
    };
  });

  return {
    storage: dates.size ? {
      ...state,
      corporateActions,
      transactions: state.transactions.filter((event) => !dropped.has(event.id)).map((event) =>
        changed.get(event.id) ?? event
      ),
    } : state,
    dates: [...dates],
  };
}
