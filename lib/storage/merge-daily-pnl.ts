import { holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { applyDividendPnlChange, dividendPnlByDate, dividendPnlChange } from "@/lib/portfolio/dividend-pnl";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { PortfolioStorage, PortfolioTransaction, SaleTransaction } from "@/lib/types/holding";

interface SummarySource {
  portfolio: PortfolioStorage;
  transactions: PortfolioTransaction[];
  changedPrices: ReadonlySet<string>;
}

function saleTerms(sale: SaleTransaction) {
  return JSON.stringify([sale.holdingId, holdingGroupKey({ ...sale, id: sale.holdingId }), sale.buyDate,
    sale.sellDate, sale.quantity, sale.sellPrice, sale.realizedPnl, sale.fee ?? 0, sale.tax ?? 0]);
}

function openingBasis(event: PortfolioTransaction) {
  return JSON.stringify([event.type, event.holdingId, holdingGroupKey({ ...event, id: event.holdingId }), event.date, event.price]);
}

function acquisitionEvents(events: PortfolioTransaction[]) {
  return new Map(events.filter((event) => event.type === "buy" || event.type === "opening_balance")
    .map((event) => [event.id, event]));
}

function datesAffectedByTrades(source: SummarySource, merged: PortfolioStorage) {
  const affected = new Set(source.changedPrices);
  const sourceSales = source.portfolio.sales;
  const sourceTerms = new Map(sourceSales.map((sale) => [sale.id, saleTerms(sale)]));
  const chosenTerms = new Map(merged.sales.map((sale) => [sale.id, saleTerms(sale)]));
  const changesByDate = new Map<string, Map<string, number>>();
  const changedLots = new Set<string>();
  const addChange = (holdingId: string, date: string, delta: number) => {
    const day = changesByDate.get(date) ?? new Map<string, number>();
    day.set(holdingId, (day.get(holdingId) ?? 0) + delta);
    changesByDate.set(date, day);
    changedLots.add(holdingId);
    affected.add(date);
  };
  const addSaleChange = (sale: SaleTransaction, sign: number) => {
    if (sale.assetType === "property") return;
    const basis = holdingActions(merged.corporateActions, { ...sale, id: sale.holdingId });
    const shares = sale.quantity * shareAdjustmentAfter(basis, sale.sellDate);
    addChange(sale.holdingId, sale.sellDate, shares * sign);
  };
  for (const sale of sourceSales) {
    if (sourceTerms.get(sale.id) !== chosenTerms.get(sale.id)) addSaleChange(sale, 1);
  }
  for (const sale of merged.sales) {
    if (chosenTerms.get(sale.id) !== sourceTerms.get(sale.id)) addSaleChange(sale, -1);
  }

  const beforeBuys = acquisitionEvents(source.transactions);
  const afterBuys = acquisitionEvents(merged.transactions);
  const changedBases: { start: string; end?: string }[] = [];
  for (const id of new Set([...beforeBuys.keys(), ...afterBuys.keys()])) {
    const previous = beforeBuys.get(id);
    const next = afterBuys.get(id);
    const basisChanged = previous && next && openingBasis(previous) !== openingBasis(next);
    if (previous && next && !basisChanged && previous.quantity === next.quantity &&
        previous.fee === next.fee && previous.tax === next.tax) continue;
    if (previous) addChange(previous.holdingId, previous.date, -(previous.quantity ?? 0));
    if (next) addChange(next.holdingId, next.date, next.quantity ?? 0);
    if (previous && next && basisChanged) {
      const [start, later] = [previous.date, next.date].sort();
      const sameInstrument = holdingGroupKey({ ...previous, id: previous.holdingId }) ===
        holdingGroupKey({ ...next, id: next.holdingId });
      // 第一筆收盤若以買入價為基準，須重算至後續可作為基準的收盤日。
      const end = sameInstrument ? merged.priceHistory[next.holdingId]?.find((point) => point.date >= later)?.date : undefined;
      changedBases.push({ start, end });
    }
  }
  if (!changesByDate.size) return affected;

  const dates = new Set(Object.keys(source.portfolio.pnlTracking.dailySummaries));
  for (const id of changedLots) {
    for (const point of merged.priceHistory[id] ?? []) dates.add(point.date);
  }
  for (const event of merged.transactions) if (changedLots.has(event.holdingId)) dates.add(event.date);
  // 股數因成交而改變，直到兩個版本在同一批次的剩餘股數相同才可沿用摘要。
  const changes = [...changesByDate].sort(([a], [b]) => a.localeCompare(b));
  const shareDifferences = new Map<string, number>();
  let cursor = 0;
  for (const date of [...dates].sort()) {
    while (cursor < changes.length && changes[cursor][0] <= date) {
      for (const [id, delta] of changes[cursor][1]) {
        const previous = shareDifferences.get(id) ?? 0;
        const sum = previous + delta;
        if (Math.abs(sum) <= 8 * Number.EPSILON * Math.max(Math.abs(previous), Math.abs(delta))) {
          shareDifferences.delete(id);
        } else {
          shareDifferences.set(id, sum);
        }
      }
      cursor += 1;
    }
    if (shareDifferences.size || changedBases.some(({ start, end }) => start <= date && (!end || date <= end))) {
      affected.add(date);
    }
  }
  return affected;
}

export function mergeDailyPnlSummaries(current: SummarySource, incoming: SummarySource, merged: PortfolioStorage) {
  const earliest = priceHistoryStartDate();
  const dividends = dividendPnlByDate(merged.transactions);
  const computedAt = new Date().toISOString();
  const compatibleSummaries = (source: SummarySource) => {
    const changes = datesAffectedByTrades(source, merged);
    const summaries = Object.fromEntries(Object.entries(source.portfolio.pnlTracking.dailySummaries)
      .filter(([date]) => !changes.has(date)));
    const original = dividendPnlByDate(source.transactions);
    for (const date of new Set([...original.keys(), ...dividends.keys()])) {
      const change = dividendPnlChange(original.get(date), dividends.get(date));
      if (!change.delta && !change.basisChanged) continue;
      if (date < earliest && summaries[date]) {
        summaries[date] = applyDividendPnlChange(summaries[date], change, computedAt);
      } else {
        delete summaries[date];
        changes.add(date);
      }
    }
    return { summaries, changes };
  };
  const local = compatibleSummaries(current);
  const backup = compatibleSummaries(incoming);
  const dailySummaries = local.summaries;
  for (const [date, summary] of Object.entries(backup.summaries)) {
    // 行情明細過期後，只能補入缺少的摘要；產生時間較新不代表採用了相同價格。
    if (!dailySummaries[date] || (date >= earliest && summary.computedAt > dailySummaries[date].computedAt)) {
      dailySummaries[date] = summary;
    }
  }
  return { dailySummaries, changedDates: new Set([...local.changes, ...backup.changes]) };
}
