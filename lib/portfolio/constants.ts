/** LocalStorage key（版本化以便未來遷移） */
export const PORTFOLIO_STORAGE_KEY = "portfolio-tracker-v1";

/** 單一標的價格歷史最多保留天數（避免 localStorage 爆量） */
export const MAX_PRICE_HISTORY_DAYS = 365;
