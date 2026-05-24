import type { FundNavData, FundNavErrorResponse } from "@/lib/fund-nav/types";

export type { FundNavData };

export interface FundNavSuccessResponse {
  success: true;
  data: FundNavData;
  source: "cache" | "fundclear";
}

export interface FundNavFailResponse {
  success?: false;
  error: string;
  code: string;
  suggestion?: string;
  details?: string;
}

export type FundNavApiResponse = FundNavSuccessResponse | FundNavFailResponse;

export function isApiError(
  res: FundNavApiResponse
): res is FundNavFailResponse & FundNavErrorResponse {
  return !("success" in res && res.success === true);
}

/** 手動輸入後在前端組裝的淨值紀錄 */
export interface ManualNavRecord extends FundNavData {
  isManual: true;
  savedAt: string;
}
