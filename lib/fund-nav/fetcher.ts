import { normalizeToIsoDate } from "@/lib/date/iso-date";
import type { FundClearRawResponse, FundNavData } from "./types";

const FUNDCLEAR_API_URL =
  "https://www.fundclear.com.tw/api/onshore/fund-basic/query-simple-data";

/** 單次請求 timeout（毫秒），避免 Vercel Serverless 長時間阻塞 */
const REQUEST_TIMEOUT_MS = 8_000;

/** 最多重試次數（含首次共 3 次） */
const MAX_RETRIES = 3;

/** 模擬瀏覽器請求，降低被 WAF / 反爬阻擋的機率 */
const DEFAULT_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://www.fundclear.com.tw",
  Referer: "https://www.fundclear.com.tw/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

export class FundNavFetchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "FundNavFetchError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 構造集保中心 API 的 Request Body。
 * 實測以 fundCode 查詢最可靠；fundName 僅作輔助（API 不一定支援）。
 */
function buildRequestBody(fundCode: string, fundName?: string): Record<string, string> {
  const body: Record<string, string> = { fundCode };

  if (fundName?.trim()) {
    body.fundName = fundName.trim();
  }

  return body;
}

/**
 * 將 API 原始回應解析為標準格式。
 * - currentNav → nav（number）
 * - navTxnDate → navDate（YYYY-MM-DD）
 */
export function parseFundClearResponse(
  raw: FundClearRawResponse,
  fundCode: string
): FundNavData {
  if (!raw.fundName || !raw.currentNav || !raw.navTxnDate) {
    throw new FundNavFetchError(
      `找不到基金代碼「${fundCode}」的淨值資料，請確認代碼是否正確`,
      "FUND_NOT_FOUND"
    );
  }

  const nav = Number.parseFloat(raw.currentNav);
  if (Number.isNaN(nav)) {
    throw new FundNavFetchError(
      `淨值格式異常：${raw.currentNav}`,
      "INVALID_NAV_FORMAT"
    );
  }

  // 統一日期格式為 ISO 風格 YYYY-MM-DD（相容 YYYY/MM/DD、YYYYMMDD）
  const navDate =
    normalizeToIsoDate(raw.navTxnDate) ?? raw.navTxnDate.replace(/\//g, "-");

  const previousNav = raw.perviousNav
    ? Number.parseFloat(raw.perviousNav)
    : undefined;

  const navChangePercent = raw.navPercent
    ? Number.parseFloat(raw.navPercent)
    : undefined;

  return {
    fundCode,
    fundName: raw.fundName,
    nav,
    navDate,
    currency: raw.currencyName ?? "TWD",
    ...(previousNav !== undefined && !Number.isNaN(previousNav) ? { previousNav } : {}),
    ...(navChangePercent !== undefined && !Number.isNaN(navChangePercent)
      ? { navChangePercent }
      : {}),
  };
}

async function fetchOnce(
  fundCode: string,
  fundName?: string,
  signal?: AbortSignal
): Promise<FundNavData> {
  const response = await fetch(FUNDCLEAR_API_URL, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(buildRequestBody(fundCode, fundName)),
    signal,
    // Next.js 15：避免快取外部 API 回應
    cache: "no-store",
  });

  if (!response.ok) {
    throw new FundNavFetchError(
      `集保中心 API 回傳 HTTP ${response.status}`,
      "UPSTREAM_HTTP_ERROR",
      response.status
    );
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new FundNavFetchError(
      `集保中心 API 回傳空內容，基金代碼可能不存在`,
      "EMPTY_RESPONSE"
    );
  }

  let raw: FundClearRawResponse;
  try {
    raw = JSON.parse(text) as FundClearRawResponse;
  } catch {
    throw new FundNavFetchError(
      "集保中心 API 回傳非 JSON 格式",
      "INVALID_JSON"
    );
  }

  return parseFundClearResponse(raw, fundCode);
}

/**
 * 帶 retry 與 timeout 的基金淨值抓取。
 * 重試策略：指數退避 300ms → 600ms
 */
export async function fetchFundNav(
  fundCode: string,
  fundName?: string
): Promise<FundNavData> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const data = await fetchOnce(fundCode, fundName, controller.signal);
      return data;
    } catch (error) {
      lastError = error;

      const isRetryable =
        error instanceof FundNavFetchError
          ? ["UPSTREAM_HTTP_ERROR", "EMPTY_RESPONSE", "INVALID_JSON"].includes(error.code)
          : error instanceof DOMException && error.name === "AbortError";

      // 業務邏輯錯誤（找不到基金）不重試
      if (error instanceof FundNavFetchError && error.code === "FUND_NOT_FOUND") {
        throw error;
      }

      if (attempt < MAX_RETRIES && isRetryable) {
        await sleep(300 * attempt);
        continue;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new FundNavFetchError(
          `請求逾時（>${REQUEST_TIMEOUT_MS}ms），已重試 ${attempt} 次`,
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
