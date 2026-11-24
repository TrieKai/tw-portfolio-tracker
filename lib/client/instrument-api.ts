/**
 * 標的名稱查詢（前端）
 */

import type { AssetType, StockMarket } from "@/lib/types/holding";

export interface InstrumentLookupSuccess {
  success: true;
  data: {
    name: string;
    symbol: string;
    assetType: AssetType;
    market?: StockMarket;
  };
}

export interface InstrumentLookupFail {
  success: false;
  error: string;
  code: string;
}

export type InstrumentLookupResponse =
  | InstrumentLookupSuccess
  | InstrumentLookupFail;

export async function lookupInstrument(
  params: {
    assetType: AssetType;
    symbol: string;
    market?: StockMarket;
  }
): Promise<InstrumentLookupResponse> {
  try {
    const res = await fetch("/api/instruments/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return (await res.json()) as InstrumentLookupResponse;
  } catch {
    return {
      success: false,
      code: "LOOKUP_UNAVAILABLE",
      error: "暫時無法查詢標的。請檢查網路連線後再試一次。",
    };
  }
}

export function isLookupError(
  res: InstrumentLookupResponse
): res is InstrumentLookupFail {
  return !("success" in res && res.success === true);
}
