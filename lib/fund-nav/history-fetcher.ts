/**
 * 集保中心 — 基金歷史淨值
 * POST /api/onshore/fund-basic/query-nav-value/picture
 */

import { fromFundclearDate, toFundclearDate } from "./date-utils";
import { FUNDCLEAR_HEADERS } from "./headers";
import type {
  FundClearNavHistoryRow,
  FundNavHistoryData,
  FundNavHistoryPoint,
} from "./types";
import { FundNavFetchError } from "./fetcher";

const FUNDCLEAR_NAV_HISTORY_URL =
  "https://www.fundclear.com.tw/api/onshore/fund-basic/query-nav-value/picture";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 3;

export interface FetchFundNavHistoryParams {
  fundCode: string;
  /** 集保格式 YYYY/MM/DD 或 ISO YYYY-MM-DD */
  startDate: string;
  endDate: string;
}

function normalizeFundCode(fundCode: string): string {
  return fundCode.replace(/\D/g, "");
}

function parseHistoryRow(row: FundClearNavHistoryRow): FundNavHistoryPoint | null {
  if (!row.navDate || !row.nav) return null;
  const nav = Number.parseFloat(row.nav);
  if (Number.isNaN(nav) || nav <= 0) return null;

  return {
    date: fromFundclearDate(row.navDate),
    nav,
    ...(row.navChangeRate !== undefined
      ? { changeRate: row.navChangeRate }
      : {}),
  };
}

/**
 * 抓取指定期間的基金每日淨值（升冪依日期排序）
 */
export async function fetchFundNavHistory(
  params: FetchFundNavHistoryParams
): Promise<FundNavHistoryData> {
  const fundCode = normalizeFundCode(params.fundCode);
  if (!fundCode) {
    throw new FundNavFetchError("基金代碼不可為空", "VALIDATION_ERROR");
  }

  const startDate = toFundclearDate(params.startDate);
  const endDate = toFundclearDate(params.endDate);

  const body = JSON.stringify({ fundCode, startDate, endDate });

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(FUNDCLEAR_NAV_HISTORY_URL, {
        method: "POST",
        headers: FUNDCLEAR_HEADERS,
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new FundNavFetchError(
          `集保歷史淨值 API HTTP ${response.status}`,
          "UPSTREAM_HTTP_ERROR",
          response.status
        );
      }

      const text = await response.text();
      if (!text.trim()) {
        throw new FundNavFetchError(
          "集保歷史淨值 API 回傳空內容",
          "EMPTY_RESPONSE"
        );
      }

      let raw: FundClearNavHistoryRow[];
      try {
        raw = JSON.parse(text) as FundClearNavHistoryRow[];
      } catch {
        throw new FundNavFetchError(
          "集保歷史淨值 API 回傳非 JSON 陣列",
          "INVALID_JSON"
        );
      }

      if (!Array.isArray(raw)) {
        throw new FundNavFetchError(
          "集保歷史淨值格式異常",
          "INVALID_RESPONSE"
        );
      }

      const points = raw
        .map(parseHistoryRow)
        .filter((p): p is FundNavHistoryPoint => p !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (points.length === 0) {
        throw new FundNavFetchError(
          `期間內無淨值資料（${startDate}～${endDate}）`,
          "NO_HISTORY_DATA"
        );
      }

      return {
        fundCode,
        startDate,
        endDate,
        points,
      };
    } catch (error) {
      lastError = error;

      if (
        error instanceof FundNavFetchError &&
        ["VALIDATION_ERROR", "NO_HISTORY_DATA", "INVALID_RESPONSE"].includes(
          error.code
        )
      ) {
        throw error;
      }

      const isRetryable =
        error instanceof FundNavFetchError
          ? error.code === "UPSTREAM_HTTP_ERROR"
          : error instanceof DOMException && error.name === "AbortError";

      if (attempt < MAX_RETRIES && isRetryable) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new FundNavFetchError(
          `歷史淨值請求逾時（>${REQUEST_TIMEOUT_MS}ms）`,
          "TIMEOUT"
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new FundNavFetchError("未知錯誤", "UNKNOWN");
}
