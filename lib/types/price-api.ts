/**
 * 價格 API 請求/回應型別（前後端共用）
 */

import type { AssetType, StockMarket } from "./holding";

/** 單次 /api/prices/batch 最多筆數（避免超過 Serverless 執行時間） */
export const MAX_BATCH_SIZE = 15;

/** 統一價格更新請求 */
export interface UpdatePriceRequest {
  assetType: AssetType;
  symbol: string;
  market?: StockMarket;
  /** 基金名稱（選填，輔助集保 API） */
  name?: string;
}

/** 統一價格更新成功回應 */
export interface UpdatePriceSuccess {
  success: true;
  assetType: AssetType;
  symbol: string;
  name: string;
  price: number;
  priceDate: string;
  currency: string;
  /** 漲跌幅等額外欄位 */
  changePercent?: number;
  source: "cache" | "twse" | "fundclear";
}

export interface UpdatePriceError {
  success: false;
  error: string;
  code: string;
  suggestion?: string;
}

export type UpdatePriceResponse = UpdatePriceSuccess | UpdatePriceError;

/** 批次更新單筆結果 */
export interface BatchUpdateItemResult {
  holdingId: string;
  symbol: string;
  assetType: AssetType;
  ok: boolean;
  data?: UpdatePriceSuccess;
  error?: string;
  code?: string;
}

export interface BatchUpdateResponse {
  success: boolean;
  results: BatchUpdateItemResult[];
  updatedAt: string;
}
