import type { StockPriceHistoryPoint } from "./stock-history-types";

const MONTH_CACHE_TTL_MS = 30 * 60 * 1000;

interface MonthCacheEntry {
  points: StockPriceHistoryPoint[];
  expiresAt: number;
}

const monthCache = new Map<string, MonthCacheEntry>();
const inflight = new Map<string, Promise<StockPriceHistoryPoint[]>>();

export function monthCacheKey(stockNo: string, monthFirstYmd: string): string {
  return `${stockNo}:${monthFirstYmd}`;
}

export function getCachedMonthPoints(
  key: string
): StockPriceHistoryPoint[] | null {
  const entry = monthCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    monthCache.delete(key);
    return null;
  }
  return entry.points;
}

export function setCachedMonthPoints(
  key: string,
  points: StockPriceHistoryPoint[]
): void {
  monthCache.set(key, {
    points,
    expiresAt: Date.now() + MONTH_CACHE_TTL_MS,
  });
}

export function getInflightMonthFetch(
  key: string
): Promise<StockPriceHistoryPoint[]> | undefined {
  return inflight.get(key);
}

export function setInflightMonthFetch(
  key: string,
  promise: Promise<StockPriceHistoryPoint[]>
): void {
  inflight.set(key, promise);
}

export function clearInflightMonthFetch(key: string): void {
  inflight.delete(key);
}
