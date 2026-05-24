/** 集保中心 query-simple-data API 原始回應結構 */
export interface FundClearRawResponse {
  navIsinCode?: string;
  fundName?: string;
  fundNameEn?: string;
  currencyName?: string;
  /** 淨值日期，格式 YYYY/MM/DD */
  navTxnDate?: string;
  /** 最新淨值（字串數字） */
  currentNav?: string;
  perviousNav?: string;
  navPercent?: string;
  fundStarValue?: string;
  fundRiskLevel?: string;
}

/** 標準化後回傳給前端的基金淨值資料 */
export interface FundNavData {
  fundCode: string;
  fundName: string;
  nav: number;
  navDate: string;
  currency: string;
  previousNav?: number;
  navChangePercent?: number;
  cached?: boolean;
  cachedAt?: string;
}

export interface FundNavRequestBody {
  fundCode: string;
  fundName?: string;
}

export interface FundNavErrorResponse {
  error: string;
  code: string;
  suggestion?: string;
  details?: string;
}

/** query-nav-value/picture API 單筆歷史淨值 */
export interface FundClearNavHistoryRow {
  navDate: string;
  nav: string;
  navChangeRate?: number;
  newestNav?: number;
}

/** 標準化歷史淨值點 */
export interface FundNavHistoryPoint {
  date: string;
  nav: number;
  changeRate?: number;
}

export interface FundNavHistoryData {
  fundCode: string;
  startDate: string;
  endDate: string;
  points: FundNavHistoryPoint[];
}
