/**
 * 前端呼叫價格 API 的封裝
 */

import type { ChartRange } from "@/lib/portfolio/calculations";
import { supportsAutoPriceUpdate } from "@/lib/portfolio/asset-labels";
import type { FundNavHistoryData } from "@/lib/fund-nav/types";
import type { StockPriceHistoryData } from "@/lib/prices/stock-history-types";
import type { Holding } from "@/lib/types/holding";
import {
  MAX_BATCH_SIZE,
  type BatchUpdateItemResult,
  type BatchUpdateResponse,
  type UpdatePriceRequest,
  type UpdatePriceResponse,
} from "@/lib/types/price-api";

export interface FundNavHistorySuccess {
  success: true;
  data: FundNavHistoryData;
}

export interface FundNavHistoryFail {
  success?: false;
  error: string;
  code: string;
}

export type FundNavHistoryResponse =
  | FundNavHistorySuccess
  | FundNavHistoryFail;

export async function fetchPriceUpdate(
  req: UpdatePriceRequest
): Promise<UpdatePriceResponse> {
  const res = await fetch("/api/prices/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return res.json() as Promise<UpdatePriceResponse>;
}

export function holdingToUpdateRequest(h: Holding): UpdatePriceRequest {
  return {
    assetType: h.assetType,
    symbol: h.symbol,
    market: h.market,
    name: h.name,
  };
}

export async function fetchBatchPriceUpdate(
  holdings: Holding[]
): Promise<BatchUpdateResponse> {
  const autoPriced = holdings.filter((h) => supportsAutoPriceUpdate(h.assetType));
  if (autoPriced.length === 0) {
    return {
      success: false,
      results: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const allResults: BatchUpdateItemResult[] = [];
  let updatedAt = new Date().toISOString();

  for (let i = 0; i < autoPriced.length; i += MAX_BATCH_SIZE) {
    const chunk = autoPriced.slice(i, i + MAX_BATCH_SIZE);
    const res = await fetch("/api/prices/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: chunk.map((h) => ({
          holdingId: h.id,
          assetType: h.assetType,
          symbol: h.symbol,
          market: h.market,
          name: h.name,
        })),
      }),
    });
    const batch = (await res.json()) as BatchUpdateResponse & {
      error?: string;
    };
    if (!res.ok || !Array.isArray(batch.results)) {
      throw new Error(batch.error ?? `批次更新失敗 (${res.status})`);
    }
    allResults.push(...batch.results);
    updatedAt = batch.updatedAt;
  }

  return {
    success: allResults.some((r) => r.ok),
    results: allResults,
    updatedAt,
  };
}

export function isPriceError(
  res: UpdatePriceResponse
): res is Extract<UpdatePriceResponse, { success: false }> {
  return "success" in res && res.success === false;
}

/**
 * 從集保載入基金歷史淨值
 */
export async function fetchFundNavHistory(
  params:
    | { fundCode: string; startDate: string; endDate: string }
    | { fundCode: string; range: ChartRange; buyDate?: string }
): Promise<FundNavHistoryResponse> {
  const res = await fetch("/api/fund-nav/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<FundNavHistoryResponse>;
}

export function isHistoryError(
  res: FundNavHistoryResponse
): res is FundNavHistoryFail {
  return !("success" in res && res.success === true);
}

export interface StockHistorySuccess {
  success: true;
  data: StockPriceHistoryData;
}

export type StockHistoryResponse = StockHistorySuccess | FundNavHistoryFail;

export async function fetchStockPriceHistory(
  params:
    | { symbol: string; market?: "tse" | "otc"; startDate: string; endDate: string }
    | {
        symbol: string;
        market?: "tse" | "otc";
        range: ChartRange;
        buyDate?: string;
      }
): Promise<StockHistoryResponse> {
  const res = await fetch("/api/prices/stock-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<StockHistoryResponse>;
}

export function isStockHistoryError(
  res: StockHistoryResponse
): res is FundNavHistoryFail {
  return !("success" in res && res.success === true);
}
