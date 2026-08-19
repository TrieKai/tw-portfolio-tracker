/** LocalStorage key（版本化以便未來遷移） */
export const PORTFOLIO_STORAGE_KEY = "portfolio-tracker-v1";

/** 單一標的逐日明細保留三年；更早日期只保留日損益總額。 */
export const MAX_PRICE_HISTORY_DAYS = 365 * 3;
