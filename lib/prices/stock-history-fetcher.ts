/**
 * 台股歷史收盤價（TWSE 上市）
 * GET /rwd/zh/afterTrading/STOCK_DAY?date=每月首日&stockNo=代號&response=json
 *
 * 上櫃（OTC）官方 API 目前無穩定公開端點，請改用手動更新或僅支援上市。
 */

import { FetchRetryError, fetchWithRetry } from "@/lib/http/fetch-with-retry";
import {
  chartRangeToIsoDates,
  listMonthFirstDaysIso,
} from "@/lib/portfolio/chart-date-range";
import type { ChartRange } from "@/lib/portfolio/calculations";
import type { StockMarket } from "@/lib/types/holding";
import { buildStockSymbolCandidates, normalizeStockSymbol } from "./stock-symbol";
import type {
  StockPriceHistoryData,
  StockPriceHistoryPoint,
} from "./stock-history-types";

const TWSE_STOCK_DAY_URL =
  "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";

const TWSE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "zh-TW,zh;q=0.9",
  Referer: "https://www.twse.com.tw/zh-page/trading/historical/stock-day.html",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

/** 各日成交資訊欄位索引 */
const COL = { DATE: 0, CLOSE: 6 } as const;

const REQUEST_TIMEOUT_MS = 10_000;
/** 單次請求最多抓幾個月（一年約 12～13 個月） */
const MAX_MONTHS_PER_REQUEST = 14;
/** TWSE 回傳空資料時的重試次數（常見於短時間大量請求） */
const EMPTY_MONTH_RETRIES = 3;
/** 連續月份請求間隔（毫秒） */
const INTER_MONTH_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StockHistoryFetchError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "StockHistoryFetchError";
  }
}

export interface FetchStockHistoryParams {
  symbol: string;
  market?: StockMarket;
  startDate: string;
  endDate: string;
}

/** 民國日期 114/05/02 → 2025-05-02 */
export function rocDateToIso(rocDate: string): string | null {
  const m = rocDate.trim().match(/^(\d+)\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10) + 1911;
  const month = m[2].padStart(2, "0");
  const day = m[3].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseClosePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, "").trim();
  if (!s || s === "--" || s === "X" || s === "0.00") return null;
  const n = Number.parseFloat(s);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

async function fetchOneMonth(
  stockNo: string,
  monthFirstYmd: string
): Promise<StockPriceHistoryPoint[]> {
  const url = `${TWSE_STOCK_DAY_URL}?date=${monthFirstYmd}&stockNo=${encodeURIComponent(stockNo)}&response=json`;

  for (let attempt = 1; attempt <= EMPTY_MONTH_RETRIES; attempt++) {
    try {
      const response = await fetchWithRetry(url, {
        headers: TWSE_HEADERS,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRetries: 3,
      });

      const json = (await response.json()) as {
        stat?: string;
        data?: string[][];
      };

      if (json.stat !== "OK" || !Array.isArray(json.data)) {
        if (attempt < EMPTY_MONTH_RETRIES) {
          await sleep(400 * attempt);
          continue;
        }
        return [];
      }

      const points: StockPriceHistoryPoint[] = [];

      for (const row of json.data) {
        const iso = rocDateToIso(row[COL.DATE]);
        const price = parseClosePrice(row[COL.CLOSE]);
        if (iso && price !== null) {
          points.push({ date: iso, price });
        }
      }

      return points;
    } catch (error) {
      if (
        error instanceof FetchRetryError &&
        error.code === "UPSTREAM_HTTP_ERROR"
      ) {
        throw new StockHistoryFetchError(error.message, "UPSTREAM_HTTP_ERROR");
      }
      if (attempt < EMPTY_MONTH_RETRIES) {
        await sleep(400 * attempt);
        continue;
      }
      throw error;
    }
  }

  return [];
}

/**
 * 抓取上市股票歷史收盤（會依代號候選嘗試，並合併多月資料）
 */
export async function fetchStockPriceHistory(
  params: FetchStockHistoryParams
): Promise<StockPriceHistoryData> {
  const market = params.market ?? "tse";

  if (market === "otc") {
    throw new StockHistoryFetchError(
      "上櫃股票歷史股價暫不支援自動載入，請使用「更新」累積或手動輸入",
      "OTC_NOT_SUPPORTED"
    );
  }

  const { startDate, endDate } = params;
  const months = listMonthFirstDaysIso(startDate, endDate).slice(
    -MAX_MONTHS_PER_REQUEST
  );

  if (months.length === 0) {
    throw new StockHistoryFetchError("日期區間無效", "VALIDATION_ERROR");
  }

  const candidates = buildStockSymbolCandidates(params.symbol);
  let allPoints: StockPriceHistoryPoint[] = [];
  let resolvedSymbol = normalizeStockSymbol(params.symbol);

  for (const stockNo of candidates) {
    const bucket: StockPriceHistoryPoint[] = [];

    try {
      for (const monthYmd of months) {
        const monthPoints = await fetchOneMonth(stockNo, monthYmd);
        bucket.push(...monthPoints);
        await sleep(INTER_MONTH_DELAY_MS);
      }

      if (bucket.length > 0) {
        allPoints = bucket;
        resolvedSymbol = stockNo;
        break;
      }
    } catch (error) {
      if (
        error instanceof StockHistoryFetchError &&
        error.code === "UPSTREAM_HTTP_ERROR"
      ) {
        throw error;
      }
      continue;
    }
  }

  const byDate = new Map<string, number>();
  for (const p of allPoints) {
    if (p.date >= startDate && p.date <= endDate) {
      byDate.set(p.date, p.price);
    }
  }

  const points = [...byDate.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) {
    throw new StockHistoryFetchError(
      `找不到「${resolvedSymbol}」在 ${startDate}～${endDate} 的收盤價`,
      "NO_HISTORY_DATA"
    );
  }

  return {
    symbol: resolvedSymbol,
    market: "tse",
    startDate,
    endDate,
    points,
  };
}

export function fetchStockHistoryByRange(
  symbol: string,
  range: ChartRange,
  options?: { market?: StockMarket; buyDate?: string }
): Promise<StockPriceHistoryData> {
  const { startDate, endDate } = chartRangeToIsoDates(range, {
    buyDate: options?.buyDate,
  });
  return fetchStockPriceHistory({
    symbol,
    market: options?.market,
    startDate,
    endDate,
  });
}
