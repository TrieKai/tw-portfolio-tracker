/**
 * 持倉列表：同一標的（類型 + 市場 + 代號）合併顯示
 */

import { normalizeStockSymbol } from "@/lib/prices/stock-symbol";
import type {
  AssetType,
  Holding,
  HoldingWithMetrics,
  StockMarket,
} from "@/lib/types/holding";

/** 合併分組鍵（房子每筆獨立顯示，不合併） */
export function holdingGroupKey(
  h: Pick<Holding, "id" | "assetType" | "symbol" | "market">
): string {
  if (h.assetType === "property") {
    return `property:${h.id}`;
  }
  const symbol =
    h.assetType === "stock"
      ? normalizeStockSymbol(h.symbol)
      : h.symbol.trim();
  const market = h.assetType === "stock" ? h.market ?? "tse" : "";
  return `${h.assetType}:${market}:${symbol}`;
}

export interface HoldingSymbolGroup {
  groupKey: string;
  assetType: AssetType;
  symbol: string;
  market?: StockMarket;
  name: string;
  lots: Holding[];
  /** 多筆買入才為 true */
  isMerged: boolean;
}

/** 將持倉依標的分組（組內依買入日升冪） */
export function groupHoldings(holdings: Holding[]): HoldingSymbolGroup[] {
  const map = new Map<string, Holding[]>();

  for (const h of holdings) {
    const key = holdingGroupKey(h);
    const bucket = map.get(key) ?? [];
    bucket.push(h);
    map.set(key, bucket);
  }

  return [...map.entries()]
    .map(([groupKey, lots]) => {
      const sorted = [...lots].sort((a, b) =>
        a.buyDate.localeCompare(b.buyDate)
      );
      const first = sorted[0]!;
      return {
        groupKey,
        assetType: first.assetType,
        symbol: first.symbol,
        market: first.market,
        name: first.name,
        lots: sorted,
        isMerged: sorted.length > 1,
      };
    })
    .sort((a, b) => {
      const bySymbol = a.symbol.localeCompare(b.symbol, "zh-TW");
      if (bySymbol !== 0) return bySymbol;
      return a.groupKey.localeCompare(b.groupKey);
    });
}

export interface HoldingGroupWithMetrics {
  groupKey: string;
  assetType: AssetType;
  symbol: string;
  market?: StockMarket;
  name: string;
  lots: HoldingWithMetrics[];
  /** 多筆買入才為 true */
  isMerged: boolean;
  quantity: number;
  /** 加權平均買入價 = 總成本 / 總數量 */
  avgBuyPrice: number;
  costBasis: number;
  marketValue: number;
  pnl: number;
  returnRate: number;
  hasLivePrice: boolean;
  currentPrice?: number;
  priceDate?: string;
  lastError?: string;
}

function pickRepresentativePrice(lots: HoldingWithMetrics[]): {
  currentPrice?: number;
  priceDate?: string;
  hasLivePrice: boolean;
} {
  const priced = lots.filter((l) => l.hasLivePrice && l.currentPrice);
  if (priced.length === 0) {
    return { hasLivePrice: false };
  }
  const best = [...priced].sort((a, b) => {
    const da = a.priceDate ?? "";
    const db = b.priceDate ?? "";
    return db.localeCompare(da);
  })[0];
  return {
    hasLivePrice: true,
    currentPrice: best.currentPrice,
    priceDate: best.priceDate,
  };
}

function aggregateGroup(
  groupKey: string,
  lots: HoldingWithMetrics[]
): HoldingGroupWithMetrics {
  const sorted = [...lots].sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const first = sorted[0];
  const quantity = sorted.reduce((s, l) => s + l.quantity, 0);
  const costBasis = sorted.reduce((s, l) => s + l.costBasis, 0);
  const marketValue = sorted.reduce((s, l) => s + l.marketValue, 0);
  const pnl = sorted.reduce((s, l) => s + l.pnl, 0);
  const avgBuyPrice = quantity > 0 ? costBasis / quantity : 0;
  const returnRate = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  const price = pickRepresentativePrice(sorted);
  const lastError = sorted.find((l) => l.lastError)?.lastError;

  return {
    groupKey,
    assetType: first.assetType,
    symbol: first.symbol,
    market: first.market,
    name: first.name,
    lots: sorted,
    isMerged: sorted.length > 1,
    quantity,
    avgBuyPrice,
    costBasis,
    marketValue,
    pnl,
    returnRate,
    hasLivePrice: price.hasLivePrice,
    currentPrice: price.currentPrice,
    priceDate: price.priceDate,
    lastError,
  };
}

/** 將持倉 metrics 依標的分組（組內依買入日升冪） */
export function groupHoldingsWithMetrics(
  holdings: HoldingWithMetrics[]
): HoldingGroupWithMetrics[] {
  const map = new Map<string, HoldingWithMetrics[]>();

  for (const h of holdings) {
    const key = holdingGroupKey(h);
    const bucket = map.get(key) ?? [];
    bucket.push(h);
    map.set(key, bucket);
  }

  return [...map.entries()].map(([key, lots]) => aggregateGroup(key, lots));
}
