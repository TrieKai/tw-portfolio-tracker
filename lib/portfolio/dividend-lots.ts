import { holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { addDaysToIsoDate, normalizeToIsoDate, parseIsoDate } from "@/lib/date/iso-date";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { Holding, PortfolioStorage, SaleTransaction } from "@/lib/types/holding";

export interface DividendLot extends Pick<Holding, "id" | "name" | "symbol" | "market"> {
  assetType: Exclude<Holding["assetType"], "property">;
  buyDate?: string;
  closedOn?: string;
}

export function listDividendLots(state: PortfolioStorage): DividendLot[] {
  const holdings = state.holdings.filter((holding) => holding.assetType !== "property");
  const archived = new Map<string, SaleTransaction>();
  const acquisitionDates = new Map<string, string>();
  for (const transaction of state.transactions) {
    if (transaction.type === "buy") acquisitionDates.set(transaction.holdingId, transaction.date);
  }
  for (const sale of state.sales) {
    if (sale.assetType === "property" || !parseIsoDate(sale.sellDate)) continue;
    const previous = archived.get(sale.holdingId);
    if (!previous || sale.sellDate > previous.sellDate ||
       (sale.sellDate === previous.sellDate && sale.createdAt > previous.createdAt)) {
      archived.set(sale.holdingId, sale);
    }
    if (sale.buyDate && !acquisitionDates.has(sale.holdingId)) {
      const date = normalizeToIsoDate(sale.buyDate);
      if (date) acquisitionDates.set(sale.holdingId, date);
    }
  }
  for (const holding of state.holdings) archived.delete(holding.id);
  return [
    ...holdings.flatMap((holding): DividendLot[] => holding.assetType === "property" ? [] : [{
      id: holding.id, name: holding.name, symbol: holding.symbol, market: holding.market,
      assetType: holding.assetType, buyDate: holding.buyDate,
    }]),
    ...[...archived.values()].flatMap((sale): DividendLot[] => sale.assetType === "property" ? [] : [{
      id: sale.holdingId, name: sale.name, symbol: sale.symbol, market: sale.market,
      assetType: sale.assetType, buyDate: acquisitionDates.get(sale.holdingId), closedOn: sale.sellDate,
    }]),
  ];
}

export function isDividendDateInPosition(lot: DividendLot, date: string): boolean {
  return !!parseIsoDate(date) && (!lot.buyDate || date > lot.buyDate) &&
    (!lot.closedOn || date <= lot.closedOn);
}

/** 以目前餘額和後續成交回推除息日前的持股，除息日賣出的股數仍計入。 */
export function dividendShareCount(state: PortfolioStorage, lot: DividendLot, date: string): number | null {
  if (!isDividendDateInPosition(lot, date)) return 0;
  const active = state.holdings.find((holding) => holding.id === lot.id);
  if (active && holdingGroupKey(active) !== holdingGroupKey(lot)) return null;
  const sales = state.sales.filter((sale) => sale.holdingId === lot.id &&
    holdingGroupKey({ ...sale, id: lot.id }) === holdingGroupKey(lot));
  if (!active && !sales.length) return null;
  const actions = holdingActions(state.corporateActions, lot);
  const soldAfter = sales.reduce((quantity, sale) => sale.sellDate >= date
    ? quantity + sale.quantity * shareAdjustmentAfter(actions, sale.sellDate) : quantity, 0);
  return ((active?.quantity ?? 0) + soldAfter) /
    shareAdjustmentAfter(actions, addDaysToIsoDate(date, -1));
}

/** 已出清部位的自動套用只記錄持有期間可核對的現金股利。 */
export function corporateEventForLot(lot: DividendLot | undefined, event: CorporateActionEvent) {
  if (!lot || lot.assetType !== "stock" || !lot.buyDate ||
      !isDividendDateInPosition(lot, event.effectiveDate) ||
      holdingGroupKey(lot) !== holdingGroupKey({ ...event, id: lot.id, assetType: "stock" })) return null;
  if (!lot.closedOn) return event;
  if (!event.cashDividend || !Number.isFinite(event.cashDividend) || event.cashDividend <= 0) return null;
  return { ...event, type: "cash_dividend" as const, stockDividendRatio: 0, subscriptionRatio: 0,
    subscriptionPrice: undefined, autoApplicable: true };
}
