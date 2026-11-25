import { normalizeToIsoDate } from "@/lib/date/iso-date";
import { costInCurrentUnits, costOnDate, holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type {
  CorporateActionRecord,
  Holding,
  PortfolioStorage,
  PriceHistoryMap,
  SaleTransaction,
} from "@/lib/types/holding";

interface HistoryLot {
  holding: Holding;
  sales: SaleTransaction[];
  actions: CorporateActionRecord[];
  removedOn?: string;
}

function groupByHoldingId<T extends { holdingId: string }>(records: T[]) {
  const byHoldingId = new Map<string, T[]>();
  for (const record of records) {
    const group = byHoldingId.get(record.holdingId);
    if (group) group.push(record);
    else byHoldingId.set(record.holdingId, [record]);
  }
  return byHoldingId;
}

function positionOn(
  lot: HistoryLot,
  date: string,
  includeSameDaySales = false
): Holding {
  const { holding, sales, actions } = lot;
  let quantity = holding.quantity;
  for (const sale of sales) {
    if (sale.sellDate > date || (includeSameDaySales && sale.sellDate === date)) {
      quantity += sale.quantity * shareAdjustmentAfter(actions, sale.sellDate);
    }
  }
  const buyPrice = Math.max(0, costOnDate(holding.buyPrice, actions, date));
  return { ...holding, buyPrice, quantity: quantity / shareAdjustmentAfter(actions, date) };
}

/** 依持倉和賣出紀錄重建先前持有的批次，舊資料只回推到可確認的追蹤起點。 */
export function buildPortfolioHistory(storage: PortfolioStorage) {
  const salesById = groupByHoldingId(storage.sales);
  const actionsById = groupByHoldingId(storage.corporateActions);
  const entriesById = groupByHoldingId(storage.transactions.filter((event) =>
    event.type === "buy" || event.type === "opening_balance"
  ));
  const lots = new Map<string, HistoryLot>();
  const dates = new Set<string>();
  const exitDates = new Set<string>();
  let unknownStartCount = 0;
  let estimatedStartCount = 0;

  const actionsFor = (id: string) => [...(actionsById.get(id) ?? [])].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt)
  );

  for (const holding of storage.holdings) {
    lots.set(holding.id, {
      holding,
      sales: salesById.get(holding.id) ?? [],
      actions: holdingActions(actionsFor(holding.id), holding),
    });
  }

  for (const { holding, removedOn } of storage.holdingRemovals ?? []) {
    if (holding.buyDate >= removedOn) continue;
    const actions = holdingActions(actionsFor(holding.id), holding);
    const instrument = holdingGroupKey(holding);
    const sales = (salesById.get(holding.id) ?? [])
      .filter((sale) => sale.sellDate <= removedOn && holdingGroupKey({ ...sale, id: holding.id }) === instrument);
    const buy = (entriesById.get(holding.id) ?? []).find((entry) => entry.type === "buy" && entry.date === holding.buyDate &&
      holdingGroupKey({ ...entry, id: holding.id }) === instrument);
    const quantity = buy?.quantity === undefined
      ? holding.quantity * shareAdjustmentAfter(actions, removedOn)
      : Math.max(0, buy.quantity - sales.reduce((sum, sale) => sum + sale.quantity * shareAdjustmentAfter(actions, sale.sellDate), 0));
    lots.set(holding.id, {
      holding: { ...holding, quantity, buyPrice: costInCurrentUnits(holding.buyPrice, actions, removedOn),
        currentPrice: holding.currentPrice === undefined ? undefined : holding.currentPrice / shareAdjustmentAfter(actions, removedOn) },
      actions, sales, removedOn,
    });
    dates.add(removedOn);
    exitDates.add(removedOn);
  }

  for (const [id, sales] of salesById) {
    if (lots.has(id)) continue;
    const orderedSales = [...sales].sort((a, b) => a.sellDate.localeCompare(b.sellDate) || a.createdAt.localeCompare(b.createdAt));
    const first = orderedSales[0];
    const latest = orderedSales.at(-1)!;
    const entries = [...(entriesById.get(id) ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const knownBuy = entries.find((entry) => entry.type === "buy")?.date ?? normalizeToIsoDate(latest.buyDate ?? "");
    const buyDate = knownBuy ?? entries[0]?.date;
    if (!buyDate || buyDate > first.sellDate) {
      unknownStartCount++;
      continue;
    }
    const actions = holdingActions(actionsFor(id), { ...latest, id });
    lots.set(id, {
      holding: {
        id,
        assetType: latest.assetType,
        name: latest.name,
        symbol: latest.symbol,
        market: latest.market,
        buyDate,
        buyPrice: costInCurrentUnits(latest.buyPrice, actions, latest.sellDate),
        quantity: 0,
        createdAt: entries[0]?.createdAt ?? latest.createdAt,
        updatedAt: latest.createdAt,
      },
      sales,
      actions,
    });
    if (!knownBuy) estimatedStartCount++;
    exitDates.add(latest.sellDate);
  }

  const initialLots = Array.from(lots.values(), (lot) =>
    positionOn(lot, lot.holding.buyDate, true)
  );

  for (const { holding, sales, actions, removedOn } of lots.values()) {
    dates.add(holding.buyDate);
    if (holding.priceDate) dates.add(holding.priceDate);
    for (const { sellDate } of sales) dates.add(sellDate);
    for (const { effectiveDate } of actions) dates.add(effectiveDate);
    for (const point of storage.priceHistory[holding.id] ?? []) {
      if (point.date >= holding.buyDate && (!removedOn || point.date < removedOn)) dates.add(point.date);
    }
  }

  function snapshotOn(date: string): Holding[] {
    const snapshots: Holding[] = [];
    for (const lot of lots.values()) {
      if (date < lot.holding.buyDate || (lot.removedOn && date >= lot.removedOn)) continue;
      const position = positionOn(lot, date);
      if (position.quantity <= 0) continue;
      let point;
      for (const candidate of storage.priceHistory[position.id] ?? []) {
        if (candidate.date >= position.buyDate && candidate.date <= date &&
          (!point || candidate.date > point.date)) point = candidate;
      }
      const { currentPrice, priceDate, priceSource } = lot.holding;
      if (currentPrice !== undefined && priceDate && priceDate >= position.buyDate &&
        priceDate <= date && (!point || priceDate > point.date)) {
        point = { price: currentPrice, date: priceDate, source: priceSource ?? "manual" };
      }
      snapshots.push({
        ...position,
        currentPrice: point ? point.price * shareAdjustmentAfter(lot.actions, date) : undefined,
        priceDate: point?.date,
        priceSource: point?.source,
      });
    }
    return snapshots;
  }

  function priceHistoryAt(date: string): PriceHistoryMap {
    return Object.fromEntries(Array.from(lots, ([id, lot]) => {
      const ratio = shareAdjustmentAfter(lot.actions, date);
      return [id, (storage.priceHistory[id] ?? [])
        .filter((point) => point.date <= date && (!lot.removedOn || point.date < lot.removedOn))
        .map((point) => ratio === 1 ? point : { ...point, price: point.price * ratio })];
    }));
  }

  return {
    dates: [...dates].sort(),
    exitDates,
    initialLots,
    unknownStartCount,
    estimatedStartCount,
    snapshotOn,
    priceHistoryAt,
  };
}

export type PortfolioHistory = ReturnType<typeof buildPortfolioHistory>;
