import type { PortfolioStorage } from "@/lib/types/holding";

/** 雲端儲存的投資組合封裝（含版本時間供衝突判斷） */
export interface CloudPortfolioEnvelope {
  updatedAt: string;
  portfolio: PortfolioStorage;
}

export type PortfolioSyncErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_BODY"
  | "KV_NOT_CONFIGURED"
  | "KV_ERROR"
  | "NOT_FOUND";

export interface PortfolioSyncGetResponse {
  success: true;
  data: CloudPortfolioEnvelope | null;
}

export interface PortfolioSyncPutResponse {
  success: true;
  updatedAt: string;
}

export interface PortfolioSyncErrorResponse {
  success: false;
  error: string;
  code: PortfolioSyncErrorCode;
}
