/**
 * 持倉歷史價格抓取（基金集保 / 上市 TWSE）
 * 同一標的多筆買入會合併請求，避免重複打外部 API 被限流。
 */

import type { ChartRange } from "@/lib/portfolio/chart-date-range";
import type { Holding, PricePoint } from "@/lib/types/holding";
import {
  fetchFundNavHistory,
  fetchStockPriceHistory,
  isHistoryError,
  isStockHistoryError,
} from "./price-api";

/** 是否可自動載入歷史（上櫃股票、房子除外） */
export function canImportHistory(holding: Holding): boolean {
  if (holding.assetType === "property") return false;
  if (holding.assetType === "fund") return true;
  return holding.market !== "otc";
}

/** 歷史抓取分組 key（同 key 共用一次 API 結果） */
export function historyFetchGroupKey(
  holding: Holding,
  range: ChartRange
): string {
  const market = holding.market ?? "tse";
  return `${holding.assetType}:${holding.symbol}:${market}:${range}`;
}

function groupHoldingsForHistoryFetch(
  holdings: Holding[],
  range: ChartRange
): Map<string, Holding[]> {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    if (!canImportHistory(h)) continue;
    const key = historyFetchGroupKey(h, range);
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }
  return groups;
}

function earliestBuyDate(holdings: Holding[]): string {
  return holdings.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    holdings[0]!.buyDate
  );
}

async function fetchHistoryPointsForGroup(
  holdings: Holding[],
  range: ChartRange
): Promise<PricePoint[]> {
  const representative = holdings[0]!;
  const buyDate =
    range === "all" ? earliestBuyDate(holdings) : representative.buyDate;

  if (representative.assetType === "fund") {
    const res = await fetchFundNavHistory({
      fundCode: representative.symbol,
      range,
      buyDate,
    });
    if (isHistoryError(res)) {
      throw new Error(res.error);
    }
    return res.data.points.map((p) => ({
      date: p.date,
      price: p.nav,
      source: "api" as const,
    }));
  }

  if (representative.market === "otc") {
    throw new Error("上櫃股票暫不支援自動載入歷史股價");
  }

  const res = await fetchStockPriceHistory({
    symbol: representative.symbol,
    market: representative.market ?? "tse",
    range,
    buyDate,
  });

  if (isStockHistoryError(res)) {
    throw new Error(res.error);
  }

  return res.data.points.map((p) => ({
    date: p.date,
    price: p.price,
    source: "api" as const,
  }));
}

export type HoldingHistoryImportResult =
  | { holdingId: string; ok: true; points: PricePoint[] }
  | { holdingId: string; ok: false; error: string };

const INTER_GROUP_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 批次載入多筆持倉歷史；同一標的只請求一次，結果套用到該組所有持倉。
 */
export async function fetchHistoryForHoldings(
  holdings: Holding[],
  range: ChartRange
): Promise<HoldingHistoryImportResult[]> {
  const groups = groupHoldingsForHistoryFetch(holdings, range);
  const results: HoldingHistoryImportResult[] = [];
  let groupIndex = 0;

  for (const group of groups.values()) {
    if (groupIndex > 0) {
      await sleep(INTER_GROUP_DELAY_MS);
    }
    groupIndex++;

    try {
      const points = await fetchHistoryPointsForGroup(group, range);
      for (const h of group) {
        results.push({ holdingId: h.id, ok: true, points });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "載入歷史失敗";
      for (const h of group) {
        results.push({ holdingId: h.id, ok: false, error: message });
      }
    }
  }

  return results;
}

export async function fetchHoldingHistoryPoints(
  holding: Holding,
  range: ChartRange
): Promise<PricePoint[]> {
  const [result] = await fetchHistoryForHoldings([holding], range);
  if (!result) {
    throw new Error("載入歷史失敗");
  }
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.points;
}
