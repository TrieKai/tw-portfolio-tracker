/**
 * 投資組合資產時間軸
 * ----------------------------------------
 * 每筆持倉有獨立買入日、買入價；僅在 buyDate 當日（含）後納入總資產與成本。
 * 成本線會在每次新買入時階梯式上升，市值則依各標的歷史價格分別推算。
 */

import type { ChartRange } from "./chart-date-range";
import { chartRangeToIsoDates } from "./chart-date-range";
import type { AssetType, Holding, PriceHistoryMap, PricePoint } from "@/lib/types/holding";

/** 某日單一持倉在組合中的狀態 */
export interface HoldingDaySnapshot {
  holdingId: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  buyDate: string;
  buyPrice: number;
  quantity: number;
  /** 該筆投入成本（買入價 × 數量） */
  costBasis: number;
  /** 當日採用的單價（市場價或買入價） */
  unitPrice: number;
  marketValue: number;
  /** 是否為買入當日建倉 */
  isBuyDate: boolean;
  /** 當日單價是否來自歷史行情（false 表示仍以買入價估算） */
  hasMarketPrice: boolean;
}

/** 單日投資組合快照 */
export interface PortfolioTimelinePoint {
  date: string;
  totalValue: number;
  totalCost: number;
  pnl: number;
  returnRate: number;
  stockValue: number;
  fundValue: number;
  propertyValue: number;
  pricedHoldings: number;
  activeHoldings: number;
  /** 當日新買入的持倉名稱 */
  newHoldings: string[];
  /** 當日新投入成本（各筆買入價 × 數量加總） */
  costAddedToday: number;
  /** 當日納入計算的所有持倉明細 */
  holdings: HoldingDaySnapshot[];
}

/** 持倉建倉摘要（供列表 UI） */
export interface HoldingLotSummary {
  holdingId: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  buyDate: string;
  buyPrice: number;
  quantity: number;
  costBasis: number;
  /** 趨勢圖中首次出現日（通常等於 buyDate） */
  entersTimelineOn: string;
}

export interface PortfolioPeriodSummary {
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  valueChange: number;
  valueChangePercent: number;
  startCost: number;
  endCost: number;
  costAddedInPeriod: number;
  /** 區間內新買入的持倉 */
  lotsAddedInPeriod: HoldingLotSummary[];
}

export function getEffectiveHistory(
  holding: Holding,
  priceHistory: PriceHistoryMap
): PricePoint[] {
  const hist = priceHistory[holding.id] ?? [];
  if (hist.length > 0) {
    return [...hist].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (holding.currentPrice && holding.priceDate) {
    return [
      {
        date: holding.priceDate,
        price: holding.currentPrice,
        source: holding.priceSource ?? "api",
      },
    ];
  }
  return [];
}

/**
 * 某日持倉市值單價
 * - 買入日前：不納入（由呼叫端 skip）
 * - 有當日或之前行情：用行情
 * - 買入日尚無行情：用買入價
 * - 買入後尚無行情：沿用買入價（成本價估算）
 */
export function getUnitPriceOnDate(
  holding: Holding,
  history: PricePoint[],
  date: string
): { unitPrice: number; hasMarketPrice: boolean } {
  let marketPrice: number | null = null;
  for (const p of history) {
    if (p.date > date) break;
    marketPrice = p.price;
  }

  if (marketPrice !== null) {
    return { unitPrice: marketPrice, hasMarketPrice: true };
  }

  return { unitPrice: holding.buyPrice, hasMarketPrice: false };
}

function collectTimelineDates(
  holdings: Holding[],
  priceHistory: PriceHistoryMap
): string[] {
  const set = new Set<string>();

  for (const h of holdings) {
    set.add(h.buyDate);
    for (const p of getEffectiveHistory(h, priceHistory)) {
      set.add(p.date);
    }
  }

  return [...sortDates(set)];
}

function sortDates(dates: Iterable<string>): string[] {
  return [...dates].sort((a, b) => a.localeCompare(b));
}

export function buildHoldingLotSummaries(
  holdings: Holding[]
): HoldingLotSummary[] {
  return [...holdings]
    .map((h) => ({
      holdingId: h.id,
      name: h.name,
      symbol: h.symbol,
      assetType: h.assetType,
      buyDate: h.buyDate,
      buyPrice: h.buyPrice,
      quantity: h.quantity,
      costBasis: h.buyPrice * h.quantity,
      entersTimelineOn: h.buyDate,
    }))
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
}

/**
 * 建立投資組合每日資產曲線（分筆買入日／買入價）
 */
/** 建立投資組合每日資產曲線，並篩選至 [startDate, endDate] */
export function buildPortfolioTimelineBetween(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  startDate: string,
  endDate: string
): PortfolioTimelinePoint[] {
  if (holdings.length === 0) return [];

  const histories = new Map(
    holdings.map((h) => [h.id, getEffectiveHistory(h, priceHistory)])
  );

  const allDates = collectTimelineDates(holdings, priceHistory);
  const rawPoints: PortfolioTimelinePoint[] = [];

  for (const date of allDates) {
    const snapshots: HoldingDaySnapshot[] = [];
    const newHoldings: string[] = [];
    let costAddedToday = 0;
    let totalValue = 0;
    let totalCost = 0;
    let stockValue = 0;
    let fundValue = 0;
    let propertyValue = 0;
    let pricedHoldings = 0;

    for (const h of holdings) {
      if (h.buyDate > date) continue;

      const hist = histories.get(h.id) ?? [];
      const costBasis = h.buyPrice * h.quantity;
      const isBuyDate = h.buyDate === date;

      if (isBuyDate) {
        newHoldings.push(h.name);
        costAddedToday += costBasis;
      }

      const { unitPrice, hasMarketPrice } = getUnitPriceOnDate(h, hist, date);
      const marketValue = unitPrice * h.quantity;

      totalCost += costBasis;
      totalValue += marketValue;
      if (h.assetType === "stock") stockValue += marketValue;
      else if (h.assetType === "fund") fundValue += marketValue;
      else propertyValue += marketValue;

      if (hasMarketPrice) pricedHoldings++;

      snapshots.push({
        holdingId: h.id,
        name: h.name,
        symbol: h.symbol,
        assetType: h.assetType,
        buyDate: h.buyDate,
        buyPrice: h.buyPrice,
        quantity: h.quantity,
        costBasis,
        unitPrice,
        marketValue,
        isBuyDate,
        hasMarketPrice,
      });
    }

    if (snapshots.length === 0) continue;

    snapshots.sort((a, b) => a.buyDate.localeCompare(b.buyDate));

    const pnl = totalValue - totalCost;
    const returnRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

    rawPoints.push({
      date,
      totalValue,
      totalCost,
      pnl,
      returnRate,
      stockValue,
      fundValue,
      propertyValue,
      pricedHoldings,
      activeHoldings: snapshots.length,
      newHoldings,
      costAddedToday,
      holdings: snapshots,
    });
  }

  return rawPoints.filter(
    (p) => p.date >= startDate && p.date <= endDate
  );
}

export function buildPortfolioTimeline(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  range: ChartRange
): PortfolioTimelinePoint[] {
  const { startDate, endDate } = chartRangeToIsoDates(range);
  return buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startDate,
    endDate
  );
}

/**
 * 區間內「累積損益」：相對所選區間第一個資料點的損益變化（起點為 0）。
 * 圖上若直接畫 totalValue - totalCost，在區間起點可能已是大幅未實現虧損，與「今年度累積」直覺不符。
 */
export function periodPnlFromTimeline(
  points: PortfolioTimelinePoint[]
): { periodPnl: number; periodReturnRate: number }[] {
  if (points.length === 0) return [];
  const baselinePnl = points[0].pnl;
  const baselineCost = points[0].totalCost;
  return points.map((p) => {
    const periodPnl = p.pnl - baselinePnl;
    const periodReturnRate =
      baselineCost > 0 ? (periodPnl / baselineCost) * 100 : 0;
    return { periodPnl, periodReturnRate };
  });
}

/** 期間市值變化（期初／期末須為區間內有資料的日期） */
export function summarizeTimelineChange(
  points: PortfolioTimelinePoint[]
): {
  startValue: number;
  endValue: number;
  change: number;
  changePercent: number;
} | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.totalValue - first.totalValue;
  const changePercent =
    first.totalValue > 0 ? (change / first.totalValue) * 100 : 0;
  return {
    startValue: first.totalValue,
    endValue: last.totalValue,
    change,
    changePercent,
  };
}

/** 期間投入與市值摘要（含區間內新買入標的） */
export function summarizePortfolioPeriod(
  holdings: Holding[],
  points: PortfolioTimelinePoint[],
  range: ChartRange
): PortfolioPeriodSummary | null {
  if (points.length < 1) return null;

  const { startDate, endDate } = chartRangeToIsoDates(range);
  const first = points[0];
  const last = points[points.length - 1];

  const lotsAddedInPeriod = buildHoldingLotSummaries(
    holdings.filter((h) => h.buyDate >= startDate && h.buyDate <= endDate)
  );

  const costAddedInPeriod = lotsAddedInPeriod.reduce(
    (sum, l) => sum + l.costBasis,
    0
  );

  const valueChange = last.totalValue - first.totalValue;
  const valueChangePercent =
    first.totalValue > 0 ? (valueChange / first.totalValue) * 100 : 0;

  return {
    startDate: first.date,
    endDate: last.date,
    startValue: first.totalValue,
    endValue: last.totalValue,
    valueChange,
    valueChangePercent,
    startCost: first.totalCost,
    endCost: last.totalCost,
    costAddedInPeriod,
    lotsAddedInPeriod,
  };
}
