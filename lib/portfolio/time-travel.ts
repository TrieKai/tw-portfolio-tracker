import { normalizeToIsoDate } from "@/lib/date/iso-date";
import { corporateActionAdjustmentRatio } from "@/lib/storage/portfolio-store";
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

/** 歷史行情及交易在套用公司行動後以最新股數單位保存。 */
function ratioAfter(actions: CorporateActionRecord[], date: string): number {
  return actions.reduce((ratio, action) =>
    date < action.effectiveDate ? ratio * corporateActionAdjustmentRatio(action) : ratio, 1
  );
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
      quantity += sale.quantity * ratioAfter(actions, sale.sellDate);
    }
  }
  let buyPrice = holding.buyPrice;
  for (const action of actions) {
    if (action.effectiveDate > date) buyPrice = action.buyPriceBefore;
  }
  return { ...holding, buyPrice, quantity: quantity / ratioAfter(actions, date) };
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
      actions: actionsFor(holding.id),
    });
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
    const actions = actionsFor(id);
    lots.set(id, {
      holding: {
        id,
        assetType: latest.assetType,
        name: latest.name,
        symbol: latest.symbol,
        market: latest.market,
        buyDate,
        buyPrice: latest.buyPrice / ratioAfter(actions, latest.sellDate),
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

  for (const { holding, sales, actions } of lots.values()) {
    dates.add(holding.buyDate);
    if (holding.priceDate) dates.add(holding.priceDate);
    for (const { sellDate } of sales) dates.add(sellDate);
    for (const { effectiveDate } of actions) dates.add(effectiveDate);
    for (const point of storage.priceHistory[holding.id] ?? []) {
      if (point.date >= holding.buyDate) dates.add(point.date);
    }
  }

  function snapshotOn(date: string): Holding[] {
    const snapshots: Holding[] = [];
    for (const lot of lots.values()) {
      if (date < lot.holding.buyDate) continue;
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
        currentPrice: point ? point.price * ratioAfter(lot.actions, date) : undefined,
        priceDate: point?.date,
        priceSource: point?.source,
      });
    }
    return snapshots;
  }

  function priceHistoryAt(date: string): PriceHistoryMap {
    return Object.fromEntries(Array.from(lots, ([id, lot]) => {
      const ratio = ratioAfter(lot.actions, date);
      return [id, (storage.priceHistory[id] ?? [])
        .filter((point) => point.date <= date)
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
