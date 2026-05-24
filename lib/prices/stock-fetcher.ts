/**
 * 台股即時/最新價格抓取（TWSE MIS API）
 * https://mis.twse.com.tw/stock/api/getStockInfo.jsp
 *
 * API 回傳 msgArray 可能為：
 * - 物件列（現行）：{ c, n, z, y, d, ... }
 * - 字串陣列列（舊版）：索引 8=成交價、13=昨收
 */

import { FetchRetryError, fetchWithRetry } from "@/lib/http/fetch-with-retry";
import type { StockMarket } from "@/lib/types/holding";
import {
  buildStockSymbolCandidates,
  normalizeStockSymbol,
} from "./stock-symbol";

export interface StockPriceData {
  symbol: string;
  name: string;
  price: number;
  priceDate: string;
  currency: "TWD";
  changePercent?: number;
  previousClose?: number;
}

const TWSE_STOCK_INFO_URL =
  "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

/** 現行 TWSE MIS 物件欄位 */
interface TwseStockObjectRow {
  c?: string;
  n?: string;
  z?: string;
  y?: string;
  o?: string;
  h?: string;
  l?: string;
  oz?: string;
  d?: string;
}

/** 舊版字串陣列欄位索引 */
const LEGACY_FIELD = {
  CODE: 0,
  NAME: 1,
  LAST_PRICE: 8,
  YESTERDAY: 13,
} as const;

const TWSE_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9",
  Referer: "https://mis.twse.com.tw/stock/index.jsp",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function buildExCh(code: string, market: StockMarket): string {
  return `${market}_${code}.tw`;
}

function parsePriceField(raw: string | undefined): number | null {
  if (!raw || raw === "-" || raw === "0.00" || raw === "0") return null;
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  return Number.isNaN(n) || n <= 0 ? null : n;
}

function formatTwseDate(d: string | undefined): string {
  if (!d || d.length !== 8) {
    return new Date().toISOString().slice(0, 10);
  }
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function isObjectRow(row: unknown): row is TwseStockObjectRow {
  return typeof row === "object" && row !== null && !Array.isArray(row);
}

/** 物件列是否為有效報價（非空殼回應） */
function isValidObjectQuote(row: TwseStockObjectRow): boolean {
  const code = row.c?.trim();
  if (!code) return false;
  const candidates = [row.z, row.oz, row.h, row.o, row.y];
  return candidates.some((f) => parsePriceField(f) !== null);
}

function parseMsgRow(
  row: string[] | TwseStockObjectRow,
  fallbackSymbol: string
): {
  symbol: string;
  name: string;
  price: number;
  priceDate: string;
  yesterday: number | null;
} {
  if (isObjectRow(row)) {
    const symbol = row.c?.trim() || fallbackSymbol;
    const name = row.n?.trim() || symbol;
    const yesterday = parsePriceField(row.y);
    const priceCandidates = [row.z, row.oz, row.h, row.o, row.y];

    let price: number | null = null;
    for (const candidate of priceCandidates) {
      price = parsePriceField(candidate);
      if (price !== null) break;
    }

    if (price === null) {
      throw new FetchRetryError(
        `無法解析「${symbol}」價格（TWSE 回傳欄位皆為空或 "-"）`,
        "INVALID_PRICE"
      );
    }

    return {
      symbol,
      name,
      price,
      priceDate: formatTwseDate(row.d),
      yesterday,
    };
  }

  const arr = row as string[];
  const symbol = arr[LEGACY_FIELD.CODE] ?? fallbackSymbol;
  const name = arr[LEGACY_FIELD.NAME] ?? symbol;
  const yesterday = parsePriceField(arr[LEGACY_FIELD.YESTERDAY]);
  let price = parsePriceField(arr[LEGACY_FIELD.LAST_PRICE]);

  if (price === null && yesterday !== null) {
    price = yesterday;
  }

  if (price === null) {
    throw new FetchRetryError(
      `無法解析「${symbol}」價格，可能非交易時段且無昨收`,
      "INVALID_PRICE"
    );
  }

  return {
    symbol,
    name,
    price,
    priceDate: formatTwseDate(undefined),
    yesterday,
  };
}

async function fetchStockInfoRow(
  code: string,
  market: StockMarket
): Promise<string[] | TwseStockObjectRow | null> {
  const exCh = buildExCh(code, market);
  const url = `${TWSE_STOCK_INFO_URL}?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;

  const response = await fetchWithRetry(url, { headers: TWSE_HEADERS });

  if (!response.ok) {
    throw new FetchRetryError(
      `TWSE API HTTP ${response.status}`,
      "UPSTREAM_HTTP_ERROR",
      response.status
    );
  }

  const json = (await response.json()) as {
    msgArray?: Array<string[] | TwseStockObjectRow>;
    rtcode?: string;
    rtmessage?: string;
  };

  if (json.rtcode && json.rtcode !== "0000") {
    throw new FetchRetryError(
      `TWSE API 錯誤：${json.rtmessage ?? json.rtcode}`,
      "UPSTREAM_ERROR"
    );
  }

  const row = json.msgArray?.[0];
  if (!row) return null;

  if (isObjectRow(row) && !isValidObjectQuote(row)) {
    return null;
  }

  return row;
}

/**
 * 從 TWSE MIS 取得單一股票報價（支援 00631L 等 ETF 槓桿/反向代號）
 */
export async function fetchStockPrice(
  symbol: string,
  market: StockMarket = "tse"
): Promise<StockPriceData> {
  const candidates = buildStockSymbolCandidates(symbol);
  let lastInvalid: FetchRetryError | null = null;

  for (const code of candidates) {
    try {
      const row = await fetchStockInfoRow(code, market);
      if (!row) continue;

      const parsed = parseMsgRow(row, code);

      let changePercent: number | undefined;
      if (parsed.yesterday !== null && parsed.yesterday > 0) {
        changePercent =
          ((parsed.price - parsed.yesterday) / parsed.yesterday) * 100;
      }

      return {
        symbol: parsed.symbol,
        name: parsed.name,
        price: parsed.price,
        priceDate: parsed.priceDate,
        currency: "TWD",
        changePercent,
        previousClose: parsed.yesterday ?? undefined,
      };
    } catch (error) {
      if (error instanceof FetchRetryError && error.code === "INVALID_PRICE") {
        lastInvalid = error;
        continue;
      }
      throw error;
    }
  }

  const display = normalizeStockSymbol(symbol);
  throw (
    lastInvalid ??
    new FetchRetryError(
      `找不到股票代號「${display}」（${market.toUpperCase()}），請確認上市/上櫃市場是否正確`,
      "STOCK_NOT_FOUND"
    )
  );
}
