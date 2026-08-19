import type { AssetType, PortfolioStorage } from "@/lib/types/holding";
import { addDaysToIsoDate, parseIsoDate, toIsoDate } from "@/lib/date/iso-date";

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
}

export interface PnlCalendarDay {
  date: string;
  pnl: number;
  /** 百分比，例如 5 表示 5%。 */
  returnRate: number;
  pricedHoldingCount: number;
  totalHoldingCount: number;
  coverageRate: number;
  quality: "complete" | "partial" | "estimated";
  isProvisional: boolean;
  contributions: PnlCalendarContribution[];
}

export interface PnlCalendarContribution {
  holdingId: string;
  name: string;
  symbol: string;
  assetType: Exclude<AssetType, "property">;
  pnl: number;
  marketPnl: number;
  tradePnl: number;
  dividend: number;
  fee: number;
  tax: number;
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
  returnRate: number;
  dataDayCount: number;
}

export interface PnlCalendarSummary {
  pnl: number;
  returnRate: number;
  gainDayCount: number;
  lossDayCount: number;
  flatDayCount: number;
  dataDayCount: number;
  completeDayCount: number;
}

interface CalendarInstrument {
  id: string;
  assetType: Exclude<AssetType, "property">;
  name: string;
  symbol: string;
  buyDate: string;
  fallbackQuantity: number;
}

interface DayAccumulator {
  pnl: number;
  baseValue: number;
  pricedHoldingIds: Set<string>;
  totalHoldingIds: Set<string>;
  contributions: Map<string, PnlCalendarContribution>;
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
  holdingId: string,
  date: string,
  fallbackQuantity: number
): number {
  const transactions = storage.transactions
    .filter(
      (transaction) =>
        transaction.holdingId === holdingId &&
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

function compoundReturn(days: PnlCalendarDay[]): number {
  return roundResult(
    (days.reduce((factor, day) => factor * (1 + day.returnRate / 100), 1) - 1) *
      100
  );
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
    contributions: new Map<string, PnlCalendarContribution>(),
  };
}

function getContribution(
  day: DayAccumulator,
  instrument: Pick<CalendarInstrument, "id" | "name" | "symbol" | "assetType">
): PnlCalendarContribution {
  const existing = day.contributions.get(instrument.id);
  if (existing) return existing;
  const created: PnlCalendarContribution = {
    holdingId: instrument.id,
    name: instrument.name,
    symbol: instrument.symbol,
    assetType: instrument.assetType,
    pnl: 0,
    marketPnl: 0,
    tradePnl: 0,
    dividend: 0,
    fee: 0,
    tax: 0,
  };
  day.contributions.set(instrument.id, created);
  return created;
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
  for (const holding of storage.holdings) {
    if (holding.assetType === "property") continue;
    instrumentById.set(holding.id, {
      id: holding.id,
      assetType: holding.assetType,
      name: holding.name,
      symbol: holding.symbol,
      buyDate: holding.buyDate,
      fallbackQuantity: holding.quantity,
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
        buyDate: transaction.date,
        fallbackQuantity: 0,
      });
    } else if (
      (transaction.type === "buy" || transaction.type === "opening_balance") &&
      transaction.date < existing.buyDate
    ) {
      existing.buyDate = transaction.date;
    }
  }
  const instruments = Array.from(instrumentById.values()).filter((instrument) =>
    matchesFilter(instrument, options.filter)
  );
  const buyDatesByHolding = new Set(
    storage.transactions
      .filter((transaction) => transaction.type === "buy")
      .map((transaction) => `${transaction.holdingId}:${transaction.date}`)
  );
  const contributionsByDate = new Map<string, DayAccumulator>();

  for (const instrument of instruments) {
    const points = (storage.priceHistory[instrument.id] ?? [])
      .filter((point) => point.date <= options.asOfDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (!current.date.startsWith(options.month)) continue;
      if (current.date < instrument.buyDate) continue;
      if (buyDatesByHolding.has(`${instrument.id}:${current.date}`)) continue;

      const quantity = quantityAtEndOfDay(
        storage,
        instrument.id,
        current.date,
        instrument.fallbackQuantity
      );
      if (quantity <= 0) continue;
      const contribution = (current.price - previous.price) * quantity;
      const existing =
        contributionsByDate.get(current.date) ?? emptyDayAccumulator();
      existing.pnl += contribution;
      existing.baseValue += previous.price * quantity;
      existing.pricedHoldingIds.add(instrument.id);
      existing.totalHoldingIds.add(instrument.id);
      const detail = getContribution(existing, instrument);
      detail.pnl += contribution;
      detail.marketPnl += contribution;
      detail.previousPrice = previous.price;
      detail.currentPrice = current.price;
      contributionsByDate.set(current.date, existing);
    }
  }

  for (const transaction of storage.transactions) {
    if (transaction.type !== "buy") continue;
    if (!matchesFilter(transaction, options.filter)) continue;
    if (!transaction.date.startsWith(options.month)) continue;
    if (transaction.date > options.asOfDate) continue;
    const quantity = transaction.quantity ?? 0;
    const buyPrice = transaction.price ?? 0;
    if (quantity <= 0 || buyPrice <= 0) continue;

    const close = (storage.priceHistory[transaction.holdingId] ?? []).find(
      (point) => point.date === transaction.date
    );
    if (!close) continue;

    const existing =
      contributionsByDate.get(transaction.date) ?? emptyDayAccumulator();
    const marketPnl = (close.price - buyPrice) * quantity;
    existing.pnl += marketPnl - transaction.fee - transaction.tax;
    existing.baseValue += buyPrice * quantity;
    existing.pricedHoldingIds.add(transaction.holdingId);
    existing.totalHoldingIds.add(transaction.holdingId);
    const instrument = instrumentById.get(transaction.holdingId)!;
    const detail = getContribution(existing, instrument);
    detail.marketPnl += marketPnl;
    detail.fee += transaction.fee;
    detail.tax += transaction.tax;
    detail.pnl += marketPnl - transaction.fee - transaction.tax;
    detail.previousPrice = buyPrice;
    detail.currentPrice = close.price;
    contributionsByDate.set(transaction.date, existing);
  }

  for (const transaction of storage.transactions) {
    if (transaction.type !== "sell") continue;
    if (!matchesFilter(transaction, options.filter)) continue;
    if (!transaction.date.startsWith(options.month)) continue;
    if (transaction.date > options.asOfDate) continue;
    const quantity = transaction.quantity ?? 0;
    const sellPrice = transaction.price ?? 0;
    if (quantity <= 0 || sellPrice <= 0) continue;

    const previous = (storage.priceHistory[transaction.holdingId] ?? [])
      .filter((point) => point.date < transaction.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!previous) continue;

    const existing =
      contributionsByDate.get(transaction.date) ?? emptyDayAccumulator();
    const tradePnl = (sellPrice - previous.price) * quantity;
    existing.pnl += tradePnl - transaction.fee - transaction.tax;
    existing.baseValue += previous.price * quantity;
    existing.pricedHoldingIds.add(transaction.holdingId);
    existing.totalHoldingIds.add(transaction.holdingId);
    const instrument = instrumentById.get(transaction.holdingId)!;
    const detail = getContribution(existing, instrument);
    detail.tradePnl += tradePnl;
    detail.fee += transaction.fee;
    detail.tax += transaction.tax;
    detail.pnl += tradePnl - transaction.fee - transaction.tax;
    detail.previousPrice = previous.price;
    detail.currentPrice = sellPrice;
    contributionsByDate.set(transaction.date, existing);
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
        const instrument = instrumentById.get(transaction.holdingId);
        const quantity = quantityAtEndOfDay(
          storage,
          transaction.holdingId,
          transaction.date,
          instrument?.fallbackQuantity ?? 0
        );
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
    const totalHoldingCount = Math.max(
      value.totalHoldingIds.size,
      instruments.filter(
        (instrument) =>
          instrument.buyDate <= date &&
          quantityAtEndOfDay(
            storage,
            instrument.id,
            date,
            instrument.fallbackQuantity
          ) > 0
      ).length
    );
    const pricedHoldingCount = value.pricedHoldingIds.size;
    const quality: PnlCalendarDay["quality"] =
      !storage.pnlTracking.startedAt || date < storage.pnlTracking.startedAt
        ? "estimated"
        : pricedHoldingCount < totalHoldingCount
          ? "partial"
          : "complete";
    return {
      date,
      pnl: value.pnl,
      returnRate:
        value.baseValue > 0 ? (value.pnl / value.baseValue) * 100 : 0,
      pricedHoldingCount,
      totalHoldingCount,
      coverageRate:
        totalHoldingCount > 0
          ? (pricedHoldingCount / totalHoldingCount) * 100
          : 0,
      quality,
      isProvisional: date === options.asOfDate,
      contributions: Array.from(value.contributions.values())
        .map((contribution) => ({
          ...contribution,
          pnl: roundResult(contribution.pnl),
          marketPnl: roundResult(contribution.marketPnl),
          tradePnl: roundResult(contribution.tradePnl),
          dividend: roundResult(contribution.dividend),
          fee: roundResult(contribution.fee),
          tax: roundResult(contribution.tax),
        }))
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    };
    }
  );
  const computedDates = new Set(computedDays.map((day) => day.date));
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
            pricedHoldingCount: 0,
            totalHoldingCount: 0,
            coverageRate: 0,
            quality:
              summary.quality === "provisional" ? "complete" : summary.quality,
            isProvisional: summary.date === options.asOfDate,
            contributions: [],
          }))
      : [];
  const days = [...computedDays, ...persistedDays].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const weekDays = new Map<string, PnlCalendarDay[]>();
  for (const day of days) {
    const { startDate } = tradingWeekBounds(day.date);
    weekDays.set(startDate, [...(weekDays.get(startDate) ?? []), day]);
  }
  const weeks = Array.from(weekDays, ([startDate, entries]) => ({
    startDate,
    endDate: addDaysToIsoDate(startDate, 4),
    pnl: roundResult(entries.reduce((sum, day) => sum + day.pnl, 0)),
    returnRate: compoundReturn(entries),
    dataDayCount: entries.length,
  })).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const summary: PnlCalendarSummary = {
    pnl: roundResult(days.reduce((sum, day) => sum + day.pnl, 0)),
    returnRate: compoundReturn(days),
    gainDayCount: days.filter((day) => day.pnl > 0).length,
    lossDayCount: days.filter((day) => day.pnl < 0).length,
    flatDayCount: days.filter((day) => day.pnl === 0).length,
    dataDayCount: days.length,
    completeDayCount: days.filter((day) => day.quality === "complete").length,
  };

  return { month: options.month, days, weeks, summary };
}
