import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { linkSaleEvents } from "@/lib/portfolio/sale-events";
import type {
  AssetType,
  PortfolioStorage,
  StockMarket,
} from "@/lib/types/holding";
import {
  addDaysToIsoDate,
  endOfMonthIsoFromPrefix,
  parseIsoDate,
  startOfMonthIsoFromPrefix,
  toIsoDate,
} from "@/lib/date/iso-date";
import { buildDailyInvestmentFinancingCosts } from "@/lib/loans/calculations";

export type PnlCalendarFilter =
  | { kind: "investment" }
  | { kind: "assetType"; assetType: Extract<AssetType, "stock" | "fund"> }
  | { kind: "holding"; holdingId: string };

export interface PnlCalendarOptions {
  /** 要顯示的月份，格式 YYYY-MM。 */
  month: string;
  /** 查詢基準日，格式 YYYY-MM-DD；之後可用於判斷暫估與未來日期。 */
  asOfDate: string;
  filter: PnlCalendarFilter;
  /** 僅 investment 篩選有效；保留 grossPnl 並扣除每日估算融資成本。 */
  includeFinancingCosts?: boolean;
}

export interface PnlCalendarDay {
  date: string;
  pnl: number;
  grossPnl?: number;
  financingCost?: number;
  /** 百分比，例如 5 表示 5%。 */
  returnRate: number | null;
  returnBase?: number;
  gapStartDate?: string;
  saleWithoutPriorPrice?: boolean;
  pricedHoldingCount: number;
  totalHoldingCount: number;
  coverageRate: number;
  quality: "complete" | "partial" | "estimated";
  isProvisional: boolean;
  contributions: PnlCalendarContribution[];
}

export interface PnlCalendarContribution {
  /** 相容既有呼叫端；合併後代表第一筆持倉。 */
  holdingId: string;
  /** 同資產分批建倉時，包含所有被合併的持倉 id。 */
  holdingIds: string[];
  name: string;
  symbol: string;
  assetType: Exclude<AssetType, "property">;
  market?: StockMarket;
  pnl: number;
  marketPnl: number;
  tradePnl: number;
  dividend: number;
  fee: number;
  tax: number;
  gapStartDate?: string;
  saleWithoutPriorPrice?: boolean;
  previousPrice?: number;
  currentPrice?: number;
}

export interface PnlCalendarResult {
  month: string;
  days: PnlCalendarDay[];
  weeks: PnlCalendarWeek[];
  summary: PnlCalendarSummary;
}

export interface PnlCalendarWeek {
  startDate: string;
  endDate: string;
  pnl: number;
  grossPnl?: number;
  financingCost?: number;
  returnRate: number | null;
  returnRateIncomplete?: boolean;
  dataDayCount: number;
}

export interface PnlCalendarSummary {
  pnl: number;
  grossPnl?: number;
  financingCost?: number;
  returnRate: number | null;
  gainDayCount: number;
  lossDayCount: number;
  flatDayCount: number;
  returnRateIncomplete?: boolean;
  dataDayCount: number;
  completeDayCount: number;
}

interface CalendarInstrument {
  id: string;
  assetType: Exclude<AssetType, "property">;
  name: string;
  symbol: string;
  market?: StockMarket;
  buyDate: string;
  buyPrice?: number;
  fallbackQuantity: number;
  knownBuyDate?: boolean;
  removedOn?: string;
}

interface ContributionAccumulator extends PnlCalendarContribution {
  previousPriceTotal: number;
  currentPriceTotal: number;
  priceQuantity: number;
}

interface DayAccumulator {
  pnl: number;
  baseValue: number;
  pricedHoldingIds: Set<string>;
  totalHoldingIds: Set<string>;
  contributions: Map<string, ContributionAccumulator>;
}

function matchesFilter(
  item: { assetType: AssetType; id?: string; holdingId?: string },
  filter: PnlCalendarFilter
): boolean {
  if (item.assetType === "property") return false;
  if (filter.kind === "investment") return true;
  if (filter.kind === "assetType") return item.assetType === filter.assetType;
  return (item.id ?? item.holdingId) === filter.holdingId;
}

function quantityAtEndOfDay(
  storage: PortfolioStorage,
  instrument: CalendarInstrument,
  date: string,
  fallbackQuantity = instrument.fallbackQuantity
): number {
  if (instrument.removedOn && date >= instrument.removedOn) return 0;
  const transactions = storage.transactions
    .filter(
      (transaction) =>
        transaction.holdingId === instrument.id &&
        transaction.date <= date &&
        (transaction.type === "opening_balance" ||
          transaction.type === "buy" ||
          transaction.type === "sell")
    )
    .sort((a, b) =>
      a.date === b.date
        ? a.createdAt.localeCompare(b.createdAt)
        : a.date.localeCompare(b.date)
    );
  if (transactions.length === 0) return fallbackQuantity;

  let quantity = 0;
  for (const transaction of transactions) {
    const eventQuantity = transaction.quantity ?? 0;
    if (transaction.type === "opening_balance") quantity = eventQuantity;
    if (transaction.type === "buy") quantity += eventQuantity;
    if (transaction.type === "sell") quantity -= eventQuantity;
  }
  return Math.max(0, quantity);
}

function roundResult(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
}

function compoundReturn(days: PnlCalendarDay[]): number | null {
  const rates = days.flatMap((day) => day.returnRate === null ? [] : [day.returnRate]);
  if (days.length && !rates.length) return null;
  return roundResult((rates.reduce((factor, rate) => factor * (1 + rate / 100), 1) - 1) * 100);
}

function notePriceGap(contribution: PnlCalendarContribution, startDate: string, endDate: string) {
  for (let date = addDaysToIsoDate(startDate, 1); date < endDate; date = addDaysToIsoDate(date, 1)) {
    const weekday = parseIsoDate(date)?.getDay();
    if (weekday !== undefined && weekday >= 1 && weekday <= 5) {
      if (!contribution.gapStartDate || startDate < contribution.gapStartDate) {
        contribution.gapStartDate = startDate;
      }
      return;
    }
  }
}

function tradingWeekBounds(iso: string): { startDate: string; endDate: string } {
  const date = parseIsoDate(iso);
  if (!date) return { startDate: iso, endDate: iso };
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startDate = toIsoDate(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayOffset)
  );
  return { startDate, endDate: addDaysToIsoDate(startDate, 4) };
}

function emptyDayAccumulator(): DayAccumulator {
  return {
    pnl: 0,
    baseValue: 0,
    pricedHoldingIds: new Set<string>(),
    totalHoldingIds: new Set<string>(),
    contributions: new Map<string, ContributionAccumulator>(),
  };
}

function getContribution(
  day: DayAccumulator,
  instrument: Pick<
    CalendarInstrument,
    "id" | "name" | "symbol" | "assetType" | "market"
  >
): ContributionAccumulator {
  // 同代號仍可能跨市場重複，因此市場必須納入合併鍵。
  const assetKey = [
    instrument.assetType,
    instrument.market ?? "",
    instrument.symbol.trim().toUpperCase(),
  ].join(":");
  const existing = day.contributions.get(assetKey);
  if (existing) {
    if (!existing.holdingIds.includes(instrument.id)) {
      existing.holdingIds.push(instrument.id);
    }
    return existing;
  }
  const created: ContributionAccumulator = {
    holdingId: instrument.id,
    holdingIds: [instrument.id],
    name: instrument.name,
    symbol: instrument.symbol,
    assetType: instrument.assetType,
    market: instrument.market,
    pnl: 0,
    marketPnl: 0,
    tradePnl: 0,
    dividend: 0,
    fee: 0,
    tax: 0,
    previousPriceTotal: 0,
    currentPriceTotal: 0,
    priceQuantity: 0,
  };
  day.contributions.set(assetKey, created);
  return created;
}

function addPriceRange(
  contribution: ContributionAccumulator,
  previousPrice: number,
  currentPrice: number,
  quantity: number
): void {
  // 多批持倉的起訖價依數量加權，避免直接顯示其中任一批的價格。
  contribution.previousPriceTotal += previousPrice * quantity;
  contribution.currentPriceTotal += currentPrice * quantity;
  contribution.priceQuantity += quantity;
  contribution.previousPrice =
    contribution.previousPriceTotal / contribution.priceQuantity;
  contribution.currentPrice =
    contribution.currentPriceTotal / contribution.priceQuantity;
}

function recordSaleWithoutPriorPrice(
  days: Map<string, DayAccumulator>,
  instrument: CalendarInstrument,
  date: string,
  realizedPnl: number,
  fee: number,
  tax: number
) {
  const day = days.get(date) ?? emptyDayAccumulator();
  const detail = getContribution(day, instrument);
  day.pnl += realizedPnl;
  day.totalHoldingIds.add(instrument.id);
  detail.pnl += realizedPnl;
  detail.tradePnl += realizedPnl + fee + tax;
  detail.fee += fee;
  detail.tax += tax;
  detail.saleWithoutPriorPrice = true;
  days.set(date, day);
}

/**
 * 建立單月損益日曆。呼叫端只需要提供完整儲存狀態，所有價格與持倉
 * 歸因規則集中在此模組，避免頁面各自重算而產生不同口徑。
 */
export function buildPnlCalendar(
  storage: PortfolioStorage,
  options: PnlCalendarOptions
): PnlCalendarResult {
  const instrumentById = new Map<string, CalendarInstrument>();
  const removals = storage.holdingRemovals ?? [];
  const removedById = new Map(removals.map(({ holding, removedOn }) => [holding.id, removedOn]));
  for (const holding of [...storage.holdings, ...removals.map((removal) => removal.holding)]) {
    if (holding.assetType === "property") continue;
    instrumentById.set(holding.id, {
      id: holding.id,
      assetType: holding.assetType,
      name: holding.name,
      symbol: holding.symbol,
      market: holding.market,
      buyDate: holding.buyDate,
      buyPrice: holding.buyPrice,
      knownBuyDate: true,
      fallbackQuantity: holding.quantity,
      removedOn: removedById.get(holding.id),
    });
  }
  for (const transaction of storage.transactions) {
    const existing = instrumentById.get(transaction.holdingId);
    if (!existing) {
      instrumentById.set(transaction.holdingId, {
        id: transaction.holdingId,
        assetType: transaction.assetType,
        name: transaction.name,
        symbol: transaction.symbol,
        market: transaction.market,
        buyDate: transaction.date,
        buyPrice: transaction.type === "buy" ? transaction.price : undefined,
        knownBuyDate: transaction.type === "buy" || transaction.type === "opening_balance",
        fallbackQuantity: 0,
      });
    } else if (
      (transaction.type === "buy" || transaction.type === "opening_balance") &&
      transaction.date < existing.buyDate
    ) {
      existing.buyDate = transaction.date;
      existing.knownBuyDate = true;
      if (transaction.type === "buy") existing.buyPrice ??= transaction.price;
    }
  }
  const instruments = Array.from(instrumentById.values()).filter((instrument) =>
    matchesFilter(instrument, options.filter)
  );
  const buys = storage.transactions.filter((transaction) => transaction.type === "buy");
  const buyDatesByHolding = new Set(buys.map((transaction) => `${transaction.holdingId}:${transaction.date}`));
  const purchaseByHolding = new Map(buys.map((transaction) => [transaction.holdingId, transaction]));
  const contributionsByDate = new Map<string, DayAccumulator>();
  const retentionStart = priceHistoryStartDate();

  for (const instrument of instruments) {
    const points = (storage.priceHistory[instrument.id] ?? [])
      .filter((point) => point.date <= options.asOfDate && (!instrument.removedOn || point.date < instrument.removedOn))
      .sort((a, b) => a.date.localeCompare(b.date));

    const purchase = purchaseByHolding.get(instrument.id);
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (!current.date.startsWith(options.month)) continue;
      if (current.date < instrument.buyDate) continue;
      if (buyDatesByHolding.has(`${instrument.id}:${current.date}`)) continue;
      const openingInterval = purchase && purchase.price !== undefined &&
        purchase.date < current.date && (!previous || previous.date < purchase.date) &&
        (purchase.date >= retentionStart || previous !== undefined);
      if (!previous && !openingInterval) continue;

      const quantity = quantityAtEndOfDay(
        storage,
        instrument,
        current.date
      );
      if (quantity <= 0) continue;
      // 首筆持有期間行情不可從建倉前收盤價起算，否則會計入尚未持有時的漲跌。
      const previousPrice = openingInterval
        ? purchase.price!
        : previous.date < instrument.buyDate && instrument.buyPrice !== undefined
          ? instrument.buyPrice
          : previous.price;
      const contribution = (current.price - previousPrice) * quantity;
      const existing =
        contributionsByDate.get(current.date) ?? emptyDayAccumulator();
      existing.pnl += contribution;
      existing.baseValue += previousPrice * quantity;
      existing.pricedHoldingIds.add(instrument.id);
      existing.totalHoldingIds.add(instrument.id);
      const detail = getContribution(existing, instrument);
      detail.pnl += contribution;
      detail.marketPnl += contribution;
      addPriceRange(detail, previousPrice, current.price, quantity);
      if (openingInterval) {
        if (!detail.gapStartDate || purchase.date < detail.gapStartDate) detail.gapStartDate = purchase.date;
      } else {
        notePriceGap(detail, previous.date < instrument.buyDate ? instrument.buyDate : previous.date, current.date);
      }
      contributionsByDate.set(current.date, existing);
    }
  }

  for (const transaction of buys) {
    if (!matchesFilter(transaction, options.filter)) continue;
    if (!transaction.date.startsWith(options.month)) continue;
    if (transaction.date > options.asOfDate) continue;
    const quantity = transaction.quantity ?? 0;
    const buyPrice = transaction.price ?? 0;
    if (quantity <= 0 || buyPrice < 0) continue;

    const close = (storage.priceHistory[transaction.holdingId] ?? []).find(
      (point) => point.date === transaction.date
    );
    if (!close && transaction.fee === 0 && transaction.tax === 0) continue;

    const existing =
      contributionsByDate.get(transaction.date) ?? emptyDayAccumulator();
    const instrument = instrumentById.get(transaction.holdingId)!;
    const retainedQuantity = Math.min(quantity, quantityAtEndOfDay(storage, instrument, transaction.date, quantity));
    const marketPnl = close ? (close.price - buyPrice) * retainedQuantity : 0;
    existing.pnl += marketPnl - transaction.fee - transaction.tax;
    if (close) {
      existing.baseValue += buyPrice * retainedQuantity;
      existing.pricedHoldingIds.add(transaction.holdingId);
    }
    existing.totalHoldingIds.add(transaction.holdingId);
    const detail = getContribution(existing, instrument);
    detail.marketPnl += marketPnl;
    detail.fee += transaction.fee;
    detail.tax += transaction.tax;
    detail.pnl += marketPnl - transaction.fee - transaction.tax;
    if (close && retainedQuantity > 0) addPriceRange(detail, buyPrice, close.price, retainedQuantity);
    contributionsByDate.set(transaction.date, existing);
  }

  const { linked: recordedSales, unlinkedSales } = linkSaleEvents(storage.sales, storage.transactions);
  for (const transaction of storage.transactions) {
    if (transaction.type !== "sell") continue;
    if (!matchesFilter(transaction, options.filter)) continue;
    if (!transaction.date.startsWith(options.month)) continue;
    if (transaction.date > options.asOfDate) continue;
    const quantity = transaction.quantity ?? 0;
    const sellPrice = transaction.price ?? 0;
    if (quantity <= 0 || sellPrice <= 0) continue;

    const sale = recordedSales.get(transaction.id);
    const instrument = instrumentById.get(transaction.holdingId)!;
    const buyDate = sale?.buyDate ?? (instrument.knownBuyDate ? instrument.buyDate : undefined);
    const previous = (storage.priceHistory[transaction.holdingId] ?? [])
      .filter((point) => point.date < transaction.date && (!buyDate || point.date >= buyDate))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!previous) {
      const fees = transaction.fee + transaction.tax;
      const realizedPnl = sale?.realizedPnl ??
        (instrument.buyPrice === undefined ? -fees : (sellPrice - instrument.buyPrice) * quantity - fees);
      recordSaleWithoutPriorPrice(
        contributionsByDate, instrument, transaction.date, realizedPnl, transaction.fee, transaction.tax
      );
      continue;
    }

    const existing =
      contributionsByDate.get(transaction.date) ?? emptyDayAccumulator();
    const tradePnl = (sellPrice - previous.price) * quantity;
    existing.pnl += tradePnl - transaction.fee - transaction.tax;
    existing.baseValue += previous.price * quantity;
    existing.pricedHoldingIds.add(transaction.holdingId);
    existing.totalHoldingIds.add(transaction.holdingId);
    const detail = getContribution(existing, instrument);
    detail.tradePnl += tradePnl;
    detail.fee += transaction.fee;
    detail.tax += transaction.tax;
    detail.pnl += tradePnl - transaction.fee - transaction.tax;
    addPriceRange(detail, previous.price, sellPrice, quantity);
    notePriceGap(detail, previous.date, transaction.date);
    contributionsByDate.set(transaction.date, existing);
  }

  for (const sale of unlinkedSales) {
    if (sale.assetType === "property" || !matchesFilter(sale, options.filter)) continue;
    if (!sale.sellDate.startsWith(options.month) || sale.sellDate > options.asOfDate) continue;
    recordSaleWithoutPriorPrice(
      contributionsByDate,
      instrumentById.get(sale.holdingId) ?? {
        ...sale,
        id: sale.holdingId,
        assetType: sale.assetType,
        buyDate: sale.buyDate ?? sale.sellDate,
        fallbackQuantity: 0,
      },
      sale.sellDate, sale.realizedPnl, sale.fee ?? 0, sale.tax ?? 0
    );
  }

  for (const transaction of storage.transactions) {
    if (transaction.type !== "cash_dividend") continue;
    if (!matchesFilter(transaction, options.filter)) continue;
    if (!transaction.date.startsWith(options.month)) continue;
    if (transaction.date > options.asOfDate) continue;
    const amount = transaction.amount ?? 0;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const existing =
      contributionsByDate.get(transaction.date) ?? emptyDayAccumulator();
    existing.pnl += amount - transaction.fee - transaction.tax;
    const instrument = instrumentById.get(transaction.holdingId)!;
    const detail = getContribution(existing, instrument);
    detail.dividend += amount;
    detail.fee += transaction.fee;
    detail.tax += transaction.tax;
    detail.pnl += amount - transaction.fee - transaction.tax;

    if (!existing.totalHoldingIds.has(transaction.holdingId)) {
      const previous = (storage.priceHistory[transaction.holdingId] ?? [])
        .filter((point) => point.date < transaction.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (previous) {
        const quantity = quantityAtEndOfDay(storage, instrument, transaction.date);
        existing.baseValue += previous.price * quantity;
        existing.pricedHoldingIds.add(transaction.holdingId);
      }
      existing.totalHoldingIds.add(transaction.holdingId);
    }
    contributionsByDate.set(transaction.date, existing);
  }

  const computedDays: PnlCalendarDay[] = Array.from(
    contributionsByDate,
    ([date, value]): PnlCalendarDay => {
      for (const instrument of instruments) {
        if (instrument.buyDate <= date && quantityAtEndOfDay(storage, instrument, date) > 0) {
          value.totalHoldingIds.add(instrument.id);
        }
      }
      const totalHoldingCount = value.totalHoldingIds.size;
      const gapStartDate = Array.from(value.contributions.values())
        .flatMap((contribution) => contribution.gapStartDate ? [contribution.gapStartDate] : [])
        .sort()[0];
      const saleWithoutPriorPrice = Array.from(value.contributions.values())
        .some((contribution) => contribution.saleWithoutPriorPrice);
      const pricedHoldingCount = value.pricedHoldingIds.size;
      const quality: PnlCalendarDay["quality"] =
        saleWithoutPriorPrice || gapStartDate || !storage.pnlTracking.startedAt || date < storage.pnlTracking.startedAt
          ? "estimated"
          : pricedHoldingCount < totalHoldingCount
            ? "partial"
            : "complete";
      return {
        date,
        pnl: value.pnl,
        returnBase: value.baseValue > 0 ? value.baseValue : undefined,
        gapStartDate,
        saleWithoutPriorPrice: saleWithoutPriorPrice || undefined,
        returnRate:
          saleWithoutPriorPrice ? null : value.baseValue > 0 ? (value.pnl / value.baseValue) * 100 : value.pnl === 0 ? 0 : null,
        pricedHoldingCount,
        totalHoldingCount,
        coverageRate:
          totalHoldingCount > 0
            ? (pricedHoldingCount / totalHoldingCount) * 100
            : 0,
        quality,
        isProvisional: date === options.asOfDate,
        contributions: Array.from(value.contributions.values())
          .map((contribution): PnlCalendarContribution => ({
            holdingId: contribution.holdingId,
            holdingIds: contribution.holdingIds,
            name: contribution.name,
            symbol: contribution.symbol,
            assetType: contribution.assetType,
            market: contribution.market,
            pnl: roundResult(contribution.pnl),
            marketPnl: roundResult(contribution.marketPnl),
            tradePnl: roundResult(contribution.tradePnl),
            dividend: roundResult(contribution.dividend),
            fee: roundResult(contribution.fee),
            tax: roundResult(contribution.tax),
            gapStartDate: contribution.gapStartDate,
            saleWithoutPriorPrice: contribution.saleWithoutPriorPrice,
            previousPrice:
              contribution.previousPrice === undefined
                ? undefined
                : roundResult(contribution.previousPrice),
            currentPrice:
              contribution.currentPrice === undefined
                ? undefined
                : roundResult(contribution.currentPrice),
          }))
          .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
      };
    }
  );
  const recentDays = computedDays.filter((day) => {
    if (!day.saleWithoutPriorPrice || options.filter.kind !== "investment") return true;
    const saved = storage.pnlTracking.dailySummaries[day.date];
    // 行情過期後沿用曾經算出的當日損益，避免再次計入整段持有期間的價差。
    return !saved || saved.saleWithoutPriorPrice || saved.returnRate === null || saved.returnBase === undefined;
  });
  const computedDates = new Set(recentDays.map((day) => day.date));
  const persistedDays: PnlCalendarDay[] =
    options.filter.kind === "investment"
      ? Object.values(storage.pnlTracking.dailySummaries)
          .filter(
            (summary) =>
              summary.date.startsWith(options.month) &&
              summary.date <= options.asOfDate &&
              !computedDates.has(summary.date)
          )
          .map((summary) => ({
            date: summary.date,
            pnl: summary.pnl,
            returnRate: summary.returnRate,
            returnBase: summary.returnBase,
            gapStartDate: summary.gapStartDate,
            saleWithoutPriorPrice: summary.saleWithoutPriorPrice,
            pricedHoldingCount: 0,
            totalHoldingCount: 0,
            coverageRate: 0,
            quality:
              summary.quality === "provisional" ? "complete" : summary.quality,
            isProvisional: summary.date === options.asOfDate,
            contributions: [],
          }))
      : [];
  const grossDays = [...recentDays, ...persistedDays].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  let days = grossDays;
  if (options.includeFinancingCosts && options.filter.kind === "investment") {
    const rangeEnd =
      options.asOfDate < endOfMonthIsoFromPrefix(options.month)
        ? options.asOfDate
        : endOfMonthIsoFromPrefix(options.month);
    const costs = buildDailyInvestmentFinancingCosts(
      storage.loans,
      startOfMonthIsoFromPrefix(options.month),
      rangeEnd
    );
    const byDate = new Map(grossDays.map((day) => [day.date, day]));
    for (const [date, financingCost] of Object.entries(costs)) {
      const gross = byDate.get(date);
      if (gross) {
        const baseValue =
          gross.returnBase ??
          (gross.returnRate ? gross.pnl / (gross.returnRate / 100) : 0);
        byDate.set(date, {
          ...gross,
          grossPnl: gross.pnl,
          financingCost,
          pnl: roundResult(gross.pnl - financingCost),
          returnRate:
            baseValue > 0 && !gross.saleWithoutPriorPrice
              ? roundResult(((gross.pnl - financingCost) / baseValue) * 100)
              : null,
          quality: "estimated",
        });
      } else {
        byDate.set(date, {
          date,
          pnl: roundResult(-financingCost),
          grossPnl: 0,
          financingCost,
          returnRate: null,
          pricedHoldingCount: 0,
          totalHoldingCount: 0,
          coverageRate: 0,
          quality: "estimated",
          isProvisional: date === options.asOfDate,
          contributions: [],
        });
      }
    }
    days = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  const weekDays = new Map<string, PnlCalendarDay[]>();
  for (const day of days) {
    const { startDate } = tradingWeekBounds(day.date);
    weekDays.set(startDate, [...(weekDays.get(startDate) ?? []), day]);
  }
  const weeks = Array.from(weekDays, ([startDate, entries]) => ({
    startDate,
    endDate: addDaysToIsoDate(startDate, 4),
    pnl: roundResult(entries.reduce((sum, day) => sum + day.pnl, 0)),
    grossPnl: roundResult(
      entries.reduce((sum, day) => sum + (day.grossPnl ?? day.pnl), 0)
    ),
    financingCost: roundResult(
      entries.reduce((sum, day) => sum + (day.financingCost ?? 0), 0)
    ),
    returnRate: compoundReturn(entries),
    returnRateIncomplete: entries.some((day) => day.returnRate === null),
    dataDayCount: entries.length,
  })).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const individuallyValued = days.filter((day) => !day.gapStartDate && !day.saleWithoutPriorPrice);
  const summary: PnlCalendarSummary = {
    pnl: roundResult(days.reduce((sum, day) => sum + day.pnl, 0)),
    grossPnl: roundResult(
      days.reduce((sum, day) => sum + (day.grossPnl ?? day.pnl), 0)
    ),
    financingCost: roundResult(
      days.reduce((sum, day) => sum + (day.financingCost ?? 0), 0)
    ),
    returnRate: compoundReturn(days),
    returnRateIncomplete: days.some((day) => day.returnRate === null),
    gainDayCount: individuallyValued.filter((day) => day.pnl > 0).length,
    lossDayCount: individuallyValued.filter((day) => day.pnl < 0).length,
    flatDayCount: individuallyValued.filter((day) => day.pnl === 0).length,
    dataDayCount: days.length,
    completeDayCount: days.filter((day) => day.quality === "complete").length,
  };

  return { month: options.month, days, weeks, summary };
}
