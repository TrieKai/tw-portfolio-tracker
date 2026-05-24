import type { FundNavData } from "./types";

/** 預設快取 TTL：4 小時（淨值通常每日更新一次） */
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

interface CacheEntry {
  data: FundNavData;
  expiresAt: number;
}

/** Serverless 實例內的 memory cache（同一 warm instance 可重用） */
const memoryCache = new Map<string, CacheEntry>();

function buildCacheKey(fundCode: string): string {
  return `fund-nav:${fundCode}`;
}

/**
 * 從 memory cache 讀取；若已過期則清除並回傳 null。
 * 生產環境可額外啟用 Vercel KV（見 getCachedFundNav）。
 */
export function getFromMemoryCache(fundCode: string): FundNavData | null {
  const key = buildCacheKey(fundCode);
  const entry = memoryCache.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return { ...entry.data, cached: true, cachedAt: new Date(entry.expiresAt - DEFAULT_TTL_MS).toISOString() };
}

export function setMemoryCache(fundCode: string, data: FundNavData, ttlMs = DEFAULT_TTL_MS): void {
  memoryCache.set(buildCacheKey(fundCode), {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * 可選：Vercel KV 跨 instance 快取。
 * 需在 Vercel 專案綁定 KV 並設定 KV_REST_API_URL / KV_REST_API_TOKEN。
 */
export async function getFromKvCache(fundCode: string): Promise<FundNavData | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }

  try {
    const { kv } = await import("@vercel/kv");
    const cached = await kv.get<FundNavData>(buildCacheKey(fundCode));
    if (!cached) return null;
    return { ...cached, cached: true };
  } catch {
    // KV 不可用時靜默降級至 memory cache
    return null;
  }
}

export async function setKvCache(
  fundCode: string,
  data: FundNavData,
  ttlSeconds = DEFAULT_TTL_MS / 1000
): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return;
  }

  try {
    const { kv } = await import("@vercel/kv");
    await kv.set(buildCacheKey(fundCode), data, { ex: ttlSeconds });
  } catch {
    // 寫入失敗不影響主流程
  }
}

export async function getCachedFundNav(fundCode: string): Promise<FundNavData | null> {
  const kvHit = await getFromKvCache(fundCode);
  if (kvHit) return kvHit;
  return getFromMemoryCache(fundCode);
}

export async function setCachedFundNav(fundCode: string, data: FundNavData): Promise<void> {
  setMemoryCache(fundCode, data);
  await setKvCache(fundCode, data);
}
