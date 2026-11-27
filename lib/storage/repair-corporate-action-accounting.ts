import { corporateActionAdjustmentRatio, holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { nextRecordTime } from "@/lib/date/next-record-time";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { reconcileCorporateDistributions } from "@/lib/portfolio/corporate-distributions";
import { applyDividendPnlChange, dividendPnlByDate, dividendPnlChange, hasNewerTradeOnSummaryDate } from "@/lib/portfolio/dividend-pnl";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import { persistPnlSummariesForDates } from "@/lib/portfolio/persist-pnl-summaries";
import { quantityAvailability } from "@/lib/portfolio/quantity";
import type { CorporateActionRecord, Holding, PortfolioStorage, SaleTransaction } from "@/lib/types/holding";

function sameAmount(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}

function changesSharesOrCost(action: CorporateActionRecord) {
  return corporateActionAdjustmentRatio(action) !== 1 || (action.cashReturnPerShare ?? 0) > 0;
}

function planRepair(state: PortfolioStorage, holding: Holding, actions: CorporateActionRecord[]) {
  const group = holdingGroupKey(holding);
  const trades = state.transactions.filter((event) => event.holdingId === holding.id &&
    (event.type === "buy" || event.type === "sell" || event.type === "opening_balance"));
  if (trades.some((event) => event.quality !== "complete" || event.source !== "user" ||
      holdingGroupKey({ ...event, id: holding.id }) !== group)) return;
  const acquisition = trades.filter((event) => event.type !== "sell");
  const [buy] = acquisition;
  if (acquisition.length !== 1 || buy.type !== "buy" || buy.date !== holding.buyDate ||
      buy.quantity === undefined || buy.price === undefined || buy.quantity <= 0) return;
  const { quantity: acquiredShares, price: acquiredPrice } = buy;

  const sales = state.sales.filter((sale) => sale.holdingId === holding.id);
  if (!sales.length || sales.some((sale) => sale.positionClosed || !parseIsoDate(sale.sellDate) || sale.sellDate < buy.date ||
      !Number.isFinite(Date.parse(sale.createdAt)) || holdingGroupKey({ ...sale, id: holding.id }) !== group)) return;
  const ledgerSales = trades.filter((event) => event.type === "sell");
  const bySaleId = new Map(ledgerSales.map((event) => [event.saleId, event]));
  if (sales.length !== ledgerSales.length || bySaleId.size !== ledgerSales.length ||
      sales.some((sale) => {
        const event = bySaleId.get(sale.id);
        const factor = shareAdjustmentAfter(actions, sale.sellDate);
        return !event || event.date !== sale.sellDate || event.quantity === undefined || event.price === undefined ||
          !sameAmount(event.quantity, sale.quantity * factor) || !sameAmount(event.price * factor, sale.sellPrice) ||
          !sameAmount(sale.proceeds, sale.quantity * sale.sellPrice) ||
          event.fee !== (sale.fee ?? 0) || event.tax !== (sale.tax ?? 0);
      })) return;

  const totalSold = ledgerSales.reduce((sum, event) => sum + (event.quantity ?? 0), 0);
  const remaining = acquiredShares - totalSold;
  const saleStatus = quantityAvailability(totalSold, acquiredShares);
  if (!saleStatus) return;
  const quantity = saleStatus === "full" ? 0 : remaining;

  const priorActions: CorporateActionRecord[] = [];
  const suspectActions: CorporateActionRecord[] = [];
  const positionTime = Date.parse(holding.positionUpdatedAt ?? holding.createdAt);
  const today = todayIsoDate();
  if (!Number.isFinite(positionTime)) return;
  const finalFactor = shareAdjustmentAfter(actions, buy.date);
  let recordedFactor = 1;
  let legacyDifference = 0;
  for (const action of [...actions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const ratio = corporateActionAdjustmentRatio(action);
    const actionTime = Date.parse(action.createdAt);
    if (action.effectiveDate <= buy.date || action.effectiveDate > today || !Number.isFinite(actionTime)) return;
    const recordedSales = sales.filter((sale) => Date.parse(sale.createdAt) <= actionTime);
    const sharesSoldAfterEffectiveDate = recordedSales.reduce((sum, sale) => sale.sellDate >= action.effectiveDate
      ? sum + sale.quantity * shareAdjustmentAfter(priorActions, sale.sellDate) : sum, 0);
    if (!action.usesEffectiveDateShares && changesSharesOrCost(action) && sharesSoldAfterEffectiveDate > 0) {
      // 舊版把生效日後已賣出的股數一併乘上倍率。以買入交易的修訂紀錄確認曾走此流程。
      if (positionTime > actionTime) return;
      if (ratio !== 1) {
        const audited = state.transactionRevisions.some((revision) => revision.transactionId === buy.id &&
          revision.correctedAt === action.createdAt && revision.reason === `公司行動 ${action.effectiveDate} 股數單位調整` &&
          revision.previous.id === buy.id && revision.previous.type === "buy" && revision.previous.date === buy.date &&
          revision.previous.quantity !== undefined && revision.previous.price !== undefined &&
          sameAmount(revision.previous.quantity, acquiredShares / finalFactor * recordedFactor) &&
          sameAmount(revision.previous.price, acquiredPrice * finalFactor / recordedFactor));
        if (!audited) return;
      } else {
        // 未換股的減資沒有股數修訂，改以入帳金額與當時餘額核對。
        const recordedSold = recordedSales.reduce((sum, sale) => sum + sale.quantity * shareAdjustmentAfter(priorActions, sale.sellDate), 0);
        const recordedBalance = acquiredShares / finalFactor * recordedFactor - recordedSold + legacyDifference;
        const returns = state.transactions.filter((event) => event.holdingId === holding.id &&
          event.type === "capital_return" && event.source === "corporate_action" && event.date === action.effectiveDate &&
          holdingGroupKey({ ...event, id: holding.id }) === group && (event.corporateActionEventId
            ? event.corporateActionEventId === action.sourceEventId : event.createdAt === action.createdAt));
        if (returns.length !== 1 || !sameAmount(action.quantityBefore, recordedBalance) ||
            !sameAmount(returns[0].amount ?? 0, recordedBalance * (action.cashReturnPerShare ?? 0))) return;
      }
      suspectActions.push(action);
      legacyDifference = legacyDifference * ratio - sharesSoldAfterEffectiveDate * (ratio - 1);
    } else {
      legacyDifference *= ratio;
    }
    recordedFactor *= ratio;
    priorActions.push(action);
  }
  if (!suspectActions.length || !sameAmount(holding.quantity, remaining + legacyDifference)) return;

  const firstDate = suspectActions.map((action) => action.effectiveDate).sort()[0];
  const evidenceTime = Math.max(...suspectActions.map((action) => Date.parse(action.createdAt)));
  let shareFactor = finalFactor;
  let buyPrice = acquiredPrice * shareFactor;
  const correctedActions = new Map<string, CorporateActionRecord>();
  const ordered = [...actions].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const action of ordered) {
    const ratio = corporateActionAdjustmentRatio(action);
    const buyPriceAfter = Math.max(0, buyPrice - (action.cashReturnPerShare ?? 0)) / ratio;
    if (action.effectiveDate < firstDate) {
      buyPrice = buyPriceAfter;
      shareFactor /= ratio;
      continue;
    }
    const sharesSoldAfter = sales.reduce((sum, sale) => sale.sellDate >= action.effectiveDate
      ? sum + (bySaleId.get(sale.id)?.quantity ?? 0) : sum, 0);
    const quantityBefore = (quantity + sharesSoldAfter) / shareFactor;
    const quantityAfter = quantityBefore * ratio;
    const totalCostBefore = quantityBefore * buyPrice;
    const totalCostAfter = quantityAfter * buyPriceAfter;
    if (![buyPrice, buyPriceAfter, quantityBefore, quantityAfter, totalCostBefore, totalCostAfter].every(Number.isFinite)) return;
    correctedActions.set(action.id, {
      ...action, quantityBefore, quantityAfter, buyPriceBefore: buyPrice, buyPriceAfter,
      totalCostBefore: action.totalCostBefore === undefined ? undefined : totalCostBefore,
      totalCostAfter: action.totalCostAfter === undefined ? undefined : totalCostAfter,
      ...(changesSharesOrCost(action) ? { usesEffectiveDateShares: true } : {}),
      updatedAt: nextRecordTime(action.updatedAt ?? action.createdAt, evidenceTime),
    });
    buyPrice = buyPriceAfter;
    shareFactor /= ratio;
  }

  const closingSale = quantity === 0 ? [...sales].sort((a, b) =>
    b.sellDate.localeCompare(a.sellDate) || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] : undefined;
  const correctedSales = new Map<string, SaleTransaction>();
  const revised = [...correctedActions.values()];
  for (const sale of sales) {
    if (sale.sellDate < firstDate) continue;
    const after = revised.findLast((action) => action.effectiveDate <= sale.sellDate);
    if (!after) continue;
    const price = after.buyPriceAfter;
    const costBasis = price * sale.quantity;
    const positionClosed = sale.id === closingSale?.id;
    if (sameAmount(costBasis, sale.costBasis) && !positionClosed) continue;
    if (!Number.isFinite(costBasis)) return;
    correctedSales.set(sale.id, {
      ...sale, buyPrice: price, costBasis, realizedPnl: sale.realizedPnl + (sale.costBasis - costBasis),
      positionClosed: positionClosed || sale.positionClosed, updatedAt: nextRecordTime(sale.updatedAt ?? sale.createdAt, evidenceTime),
    });
  }

  return { holding: quantity > 0 ? { ...holding, quantity, buyPrice } : null, correctedActions, correctedSales, firstDate, evidenceTime };
}

/** 由可核對的舊版交易重建股數與成本，成交條件與原始交易帳維持原樣。 */
export function repairCorporateActionAccounting(state: PortfolioStorage): PortfolioStorage {
  const candidates = new Set(state.corporateActions.filter((action) => !action.usesEffectiveDateShares &&
    changesSharesOrCost(action)).map((action) => action.holdingId));
  if (!candidates.size) return state;

  const dates = new Set<string>();
  let next = state;
  let computedAt = 0;
  for (const holding of state.holdings) {
    if (holding.assetType !== "stock" || !candidates.has(holding.id)) continue;
    const result = planRepair(next, holding, holdingActions(next.corporateActions, holding));
    if (!result) continue;
    next = {
      ...next,
      holdings: next.holdings.flatMap((lot) => lot.id !== holding.id ? [lot] : result.holding ? [result.holding] : []),
      corporateActions: next.corporateActions.map((action) => result.correctedActions.get(action.id) ?? action),
      sales: next.sales.map((sale) => result.correctedSales.get(sale.id) ?? sale),
    };
    const reconciled = reconcileCorporateDistributions(next, holding.id, result.evidenceTime);
    next = reconciled.storage;
    computedAt = Math.max(computedAt, result.evidenceTime);
    for (const date of reconciled.dates) dates.add(date);
    for (const action of result.correctedActions.values()) dates.add(action.effectiveDate);
    for (const sale of result.correctedSales.values()) dates.add(sale.sellDate);
    for (const point of next.priceHistory[holding.id] ?? []) if (point.date >= result.firstDate) dates.add(point.date);
  }
  if (next === state) return state;
  const cutoff = priceHistoryStartDate();
  const dailySummaries = { ...next.pnlTracking.dailySummaries };
  for (const date of dates) computedAt = Math.max(computedAt, Date.parse(dailySummaries[date]?.computedAt ?? "") || 0);
  const correctedAt = new Date(computedAt + 1).toISOString();
  const before = dividendPnlByDate(state.transactions);
  const after = dividendPnlByDate(next.transactions);
  for (const date of dates) {
    const summary = dailySummaries[date];
    if (date >= cutoff || !summary || hasNewerTradeOnSummaryDate(state.transactions, summary)) continue;
    // 行情過期後仍可核對現金股利差額。原估值總額需要當日行情才能重算。
    dailySummaries[date] = applyDividendPnlChange(summary, dividendPnlChange(before.get(date), after.get(date)), correctedAt);
  }
  return persistPnlSummariesForDates({ ...next, pnlTracking: { ...next.pnlTracking, dailySummaries } },
    [...dates].filter((date) => date >= cutoff), correctedAt);
}
