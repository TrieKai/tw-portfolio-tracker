import { corporateActionAdjustmentRatio } from "@/lib/corporate-actions/adjustment";
import { nextRecordTime } from "@/lib/date/next-record-time";
import { dividendShareCount, listDividendLots } from "@/lib/portfolio/dividend-lots";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { PortfolioStorage, PortfolioTransaction } from "@/lib/types/holding";

export function reconcileCorporateDistributions(state: PortfolioStorage, holdingId?: string, recordedAt?: number) {
  const actions = state.corporateActions.filter((action) => !holdingId || action.holdingId === holdingId);
  if (!actions.length) return { storage: state, dates: [] as string[] };
  const candidates = state.transactions.filter((event) =>
    (event.type === "cash_dividend" || event.type === "capital_return") && event.source === "corporate_action" &&
    (!holdingId || event.holdingId === holdingId)
  );

  const byDate = new Map<string, PortfolioTransaction[]>();
  for (const event of candidates) {
    const key = `${event.holdingId}:${event.date}`;
    const records = byDate.get(key) ?? [];
    records.push(event);
    byDate.set(key, records);
  }
  const lots = new Map(listDividendLots(state).map((lot) => [lot.id, lot]));
  const removedIds = new Set((state.holdingRemovals ?? []).map(({ holding }) => holding.id));
  const manual = new Set(state.transactions
    .filter((event) => event.type === "cash_dividend" && event.source === "user")
    .map((event) => JSON.stringify([event.holdingId, event.date, event.amount])));
  const changed = new Map<string, PortfolioTransaction>();
  const dropped = new Set<string>();
  const revisedActions = new Map<string, PortfolioStorage["corporateActions"][number]>();
  const dates = new Set<string>();
  const intradayRatios = new Map<string, number>();
  actions.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt));
  for (const action of actions) {
    const lot = lots.get(action.holdingId);
    const removed = removedIds.has(action.holdingId);
    const instrument = holdingGroupKey({ ...action, id: action.holdingId });
    if (!removed && (!lot || holdingGroupKey(lot) !== instrument)) continue;
    const dayKey = `${action.holdingId}:${action.effectiveDate}`;
    const ratio = corporateActionAdjustmentRatio(action);
    const precedingRatio = intradayRatios.get(dayKey) ?? 1;
    intradayRatios.set(dayKey, precedingRatio * ratio);
    const openingShares = !removed && lot ? dividendShareCount(state, lot, action.effectiveDate) : null;
    if (openingShares === null && !removed) continue;
    const cashReturn = action.cashReturnPerShare ?? 0;
    const shareChange = ratio !== 1 || cashReturn > 0;
    const quantity = openingShares === null ? null : openingShares * (shareChange ? precedingRatio : 1);
    const records = byDate.get(dayKey) ?? [];

    for (const [type, perShare, shares] of [
      ["cash_dividend", action.cashDividend ?? 0, openingShares],
      ["capital_return", cashReturn, quantity],
    ] as const) {
      if (!(perShare > 0)) continue;
      const matching = records.filter((entry) => entry.type === type &&
        holdingGroupKey({ ...entry, id: entry.holdingId }) === instrument);
      const linked = matching.filter((entry) => entry.corporateActionEventId === action.sourceEventId);
      const legacyCandidates = matching.filter((entry) => !entry.corporateActionEventId && entry.createdAt === action.createdAt);
      const ambiguous = legacyCandidates.length > 0 && actions.some((other) =>
        other.id !== action.id && other.holdingId === action.holdingId && other.effectiveDate === action.effectiveDate &&
        other.createdAt === action.createdAt && holdingGroupKey({ ...other, id: other.holdingId }) === instrument &&
        ((type === "cash_dividend" ? other.cashDividend : other.cashReturnPerShare) ?? 0) > 0);
      const legacy = ambiguous ? [] : legacyCandidates;
      const [distribution, ...duplicates] = [...linked, ...legacy];
      if (!distribution) continue;
      // 已移除批次保留先前入帳金額，仍比對備份中的重複紀錄。
      const amount = shares === null ? distribution.amount : shares * perShare;
      if (type === "cash_dividend" && manual.has(JSON.stringify([action.holdingId, action.effectiveDate, amount]))) {
        dropped.add(distribution.id);
        dates.add(action.effectiveDate);
      } else if (amount !== distribution.amount || !distribution.corporateActionEventId) {
        changed.set(distribution.id, {
          ...distribution, amount, corporateActionEventId: action.sourceEventId, updatedAt: nextRecordTime(distribution.updatedAt, recordedAt),
        });
        dates.add(action.effectiveDate);
      }
      for (const duplicate of duplicates) {
        dropped.add(duplicate.id);
        dates.add(action.effectiveDate);
      }
    }
    if ((!shareChange && !action.cashDividend) || quantity === null || quantity === action.quantityBefore) continue;
    const quantityAfter = quantity * ratio;
    dates.add(action.effectiveDate);
    revisedActions.set(action.id, {
      ...action,
      quantityBefore: quantity,
      quantityAfter,
      totalCostBefore: action.totalCostBefore === undefined ? undefined : action.buyPriceBefore * quantity,
      totalCostAfter: action.totalCostAfter === undefined ? undefined : action.buyPriceAfter * quantityAfter,
      updatedAt: nextRecordTime(action.updatedAt ?? action.createdAt, recordedAt),
    });
  }

  return {
    storage: dates.size ? {
      ...state,
      corporateActions: state.corporateActions.map((action) => revisedActions.get(action.id) ?? action),
      transactions: state.transactions.filter((event) => !dropped.has(event.id)).map((event) =>
        changed.get(event.id) ?? event
      ),
    } : state,
    dates: [...dates],
  };
}
