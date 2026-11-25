import type { StockMarket } from "@/lib/types/holding";

export const MAX_CORPORATE_ACTION_LOOKUP_ITEMS = 50;

export interface CorporateActionLookupItem {
  holdingId: string;
  symbol: string;
  market?: StockMarket;
  buyDate: string;
}

export type CorporateActionEventType =
  | "stock_dividend"
  | "cash_dividend"
  | "rights_issue"
  | "mixed"
  | "manual_review";

export interface CorporateActionEvent {
  id: string;
  holdingId: string;
  symbol: string;
  market: StockMarket;
  name: string;
  type: CorporateActionEventType;
  effectiveDate: string;
  source: "twse" | "tpex";
  exDividendLabel: string;
  stockDividendRatio: number;
  subscriptionRatio: number;
  subscriptionPrice?: number;
  cashDividend?: number;
  note?: string;
  autoApplicable: boolean;
}

export type CorporateActionLookupResponse =
  | {
      success: true;
      events: CorporateActionEvent[];
      updatedAt: string;
    }
  | {
      success: false;
      error: string;
      code: string;
      suggestion?: string;
    };
