import { normalizeToIsoDate } from "@/lib/date/iso-date";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";

/** 只提供真正存在價格快照的日期，避免時間軸顯示無法重建的空白日期。 */
export function getPortfolioHistoryDates(
  holdings: Holding[],
  priceHistory: PriceHistoryMap
): string[] {
  const holdingIds = new Set(holdings.map((holding) => holding.id));
  const dates = new Set<string>();
  for (const [holdingId, points] of Object.entries(priceHistory)) {
    if (!holdingIds.has(holdingId)) continue;
    for (const point of points) {
      const normalized =
        typeof point?.date === "string" ? normalizeToIsoDate(point.date) : undefined;
      if (normalized) dates.add(normalized);
    }
  }
  return [...dates].sort();
}

export function trimPriceHistoryAtDate(
  priceHistory: PriceHistoryMap,
  date: string
): PriceHistoryMap {
  return Object.fromEntries(
    Object.entries(priceHistory).map(([holdingId, points]) => [
      holdingId,
      points.filter((point) => point.date <= date),
    ])
  );
}

/**
 * 以指定日最近一筆已知價格，重建「目前仍存在之持倉」在當日的樣貌。
 * 完全賣出的舊持倉缺少完整買入資訊，因此不在此推測性補回。
 */
export function buildHoldingsSnapshot(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  date: string
): Holding[] {
  return holdings
    .filter((holding) => holding.buyDate <= date)
    .map((holding) => {
      const point = [...(priceHistory[holding.id] ?? [])]
        .filter((candidate) => candidate.date <= date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      const canUseCurrentPrice =
        holding.priceDate !== undefined && holding.priceDate <= date;
      const currentPrice = point?.price ??
        (canUseCurrentPrice ? holding.currentPrice : undefined) ??
        holding.buyPrice;

      return {
        ...holding,
        currentPrice,
        priceDate: point?.date ?? (canUseCurrentPrice ? holding.priceDate : date),
        priceSource: point?.source ?? holding.priceSource ?? "manual",
      };
    });
}
