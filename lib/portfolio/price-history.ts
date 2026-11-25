import type { Holding, PricePoint } from "@/lib/types/holding";

/** 舊版回填可能把較早的價格設為現價，已保留的新日期可以直接修復。 */
export function restoreLatestQuote(holding: Holding, history: PricePoint[] = []): Holding {
  const latest = history.at(-1);
  if (!holding.priceDate || !latest || latest.date <= holding.priceDate) return holding;
  return { ...holding, currentPrice: latest.price, priceDate: latest.date, priceSource: latest.source };
}

export function pnlDatesUsingChangedPrices(
  points: PricePoint[],
  changedDates: ReadonlySet<string>,
  eventDates: string[]
): Set<string> {
  const affected = new Set<string>();
  // 一筆行情也會成為下一個估值日，以及兩個估值日之間成交與配息的比較基準。
  for (const [index, point] of points.entries()) {
    if (!changedDates.has(point.date)) continue;
    affected.add(point.date);
    const nextDate = points[index + 1]?.date;
    if (nextDate) affected.add(nextDate);
    for (const date of eventDates) {
      if (date > point.date && (!nextDate || date <= nextDate)) affected.add(date);
    }
  }
  return affected;
}
