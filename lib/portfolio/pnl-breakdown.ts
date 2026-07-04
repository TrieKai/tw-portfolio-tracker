/**
 * 未實現損益分項（依標的／資產類型）
 */

import {
  addDaysToIsoDate,
  currentYearMonthPrefix,
  endDateForMonthPrefix,
  startOfMonthIsoFromPrefix,
  todayIsoDate,
} from "@/lib/date/iso-date";
import { getAssetTypeLabel } from "@/lib/portfolio/asset-labels";
import {
  groupHoldingsWithMetrics,
  holdingGroupKey,
  type HoldingGroupWithMetrics,
} from "@/lib/portfolio/holding-groups";
import {
  buildPortfolioTimelineBetween,
  getEffectiveHistory,
  getUnitPriceOnDate,
} from "@/lib/portfolio/portfolio-timeline";
import type {
  AssetType,
  Holding,
  HoldingWithMetrics,
  PriceHistoryMap,
} from "@/lib/types/holding";

export interface PnlBreakdownRow {
  groupKey: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  amount: number;
}

export interface PnlAssetTypeRow {
  assetType: AssetType;
  label: string;
  amount: number;
}

export interface PnlBreakdown {
  total: number;
  byAssetType: PnlAssetTypeRow[];
  byHolding: PnlBreakdownRow[];
}

export interface PeriodPnlBreakdown {
  startDate: string;
  endDate: string;
  total: number;
  byAssetType: PnlAssetTypeRow[];
  byHolding: PnlBreakdownRow[];
}

const ASSET_TYPES: AssetType[] = ["stock", "fund", "property"];

function computeHoldingPnlOnDate(
  holding: Holding,
  priceHistory: PriceHistoryMap,
  date: string
): number | null {
  if (holding.buyDate > date) return null;

  const history = getEffectiveHistory(holding, priceHistory);
  const { unitPrice } = getUnitPriceOnDate(holding, history, date);
  const costBasis = holding.buyPrice * holding.quantity;
  return unitPrice * holding.quantity - costBasis;
}

function computeHoldingPnlChangeBetween(
  holding: Holding,
  priceHistory: PriceHistoryMap,
  startDate: string,
  endDate: string
): number | null {
  if (holding.buyDate > endDate) return null;

  const endPnl = computeHoldingPnlOnDate(holding, priceHistory, endDate);
  if (endPnl === null) return null;

  if (holding.buyDate > startDate) {
    return endPnl;
  }

  const startPnl = computeHoldingPnlOnDate(holding, priceHistory, startDate);
  if (startPnl === null) return null;

  return endPnl - startPnl;
}

function aggregateLotsToGroups(
  holdings: Holding[],
  computeAmount: (holding: Holding) => number | null
): PnlBreakdownRow[] {
  const map = new Map<string, PnlBreakdownRow>();

  for (const h of holdings) {
    const amount = computeAmount(h);
    if (amount === null) continue;

    const key = holdingGroupKey(h);
    const existing = map.get(key);
    if (existing) {
      existing.amount += amount;
      continue;
    }

    map.set(key, {
      groupKey: key,
      name: h.name,
      symbol: h.symbol,
      assetType: h.assetType,
      amount,
    });
  }

  return [...map.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function buildAssetTypeSubtotals(rows: PnlBreakdownRow[]): PnlAssetTypeRow[] {
  const totals = new Map<AssetType, number>();
  for (const row of rows) {
    totals.set(row.assetType, (totals.get(row.assetType) ?? 0) + row.amount);
  }

  return ASSET_TYPES.filter((t) => (totals.get(t) ?? 0) !== 0).map((assetType) => ({
    assetType,
    label: getAssetTypeLabel(assetType),
    amount: totals.get(assetType) ?? 0,
  }));
}

function fromGroupedHoldings(groups: HoldingGroupWithMetrics[]): PnlBreakdown {
  const byHolding: PnlBreakdownRow[] = groups
    .filter((g) => g.hasLivePrice)
    .map((g) => ({
      groupKey: g.groupKey,
      name: g.name,
      symbol: g.symbol,
      assetType: g.assetType,
      amount: g.pnl,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const total = byHolding.reduce((s, r) => s + r.amount, 0);

  return {
    total,
    byAssetType: buildAssetTypeSubtotals(byHolding),
    byHolding,
  };
}

function fromPeriodRows(
  rows: PnlBreakdownRow[],
  startDate: string,
  endDate: string
): PeriodPnlBreakdown {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    total,
    startDate,
    endDate,
    byAssetType: buildAssetTypeSubtotals(rows),
    byHolding: rows,
  };
}

/** 累計未實現損益分項 */
export function buildTotalUnrealizedBreakdown(
  holdings: HoldingWithMetrics[]
): PnlBreakdown {
  return fromGroupedHoldings(groupHoldingsWithMetrics(holdings));
}

function buildPeriodBreakdown(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  startDate: string,
  endDate: string
): PeriodPnlBreakdown | null {
  const rows = aggregateLotsToGroups(holdings, (h) =>
    computeHoldingPnlChangeBetween(h, priceHistory, startDate, endDate)
  );

  if (rows.length === 0) return null;

  return fromPeriodRows(rows, startDate, endDate);
}

/** 日未實現變化分項 */
export function buildDailyUnrealizedBreakdown(
  holdings: Holding[],
  priceHistory: PriceHistoryMap
): PeriodPnlBreakdown | null {
  if (holdings.length === 0) return null;

  const today = todayIsoDate();
  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    addDaysToIsoDate(today, -7),
    today
  );

  if (points.length < 2) return null;

  const last = points[points.length - 1];
  if (last.date !== today) return null;

  const prev = points[points.length - 2];
  return buildPeriodBreakdown(holdings, priceHistory, prev.date, today);
}

/** 月未實現變化分項 */
export function buildMonthlyUnrealizedBreakdown(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  monthPrefix: string = currentYearMonthPrefix()
): PeriodPnlBreakdown | null {
  if (holdings.length === 0) return null;

  const startDate = startOfMonthIsoFromPrefix(monthPrefix);
  const endDate = endDateForMonthPrefix(monthPrefix);
  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    startDate,
    endDate
  );

  if (points.length === 0) return null;

  const first = points[0];
  const last = points[points.length - 1];
  return buildPeriodBreakdown(holdings, priceHistory, first.date, last.date);
}

export interface PortfolioPnlBreakdowns {
  totalUnrealized: PnlBreakdown;
  dailyUnrealized: PeriodPnlBreakdown | null;
  monthlyUnrealized: PeriodPnlBreakdown | null;
}

export function buildPortfolioPnlBreakdowns(
  holdings: HoldingWithMetrics[],
  priceHistory: PriceHistoryMap
): PortfolioPnlBreakdowns {
  const rawHoldings = holdings as Holding[];
  return {
    totalUnrealized: buildTotalUnrealizedBreakdown(holdings),
    dailyUnrealized: buildDailyUnrealizedBreakdown(rawHoldings, priceHistory),
    monthlyUnrealized: buildMonthlyUnrealizedBreakdown(
      rawHoldings,
      priceHistory
    ),
  };
}
