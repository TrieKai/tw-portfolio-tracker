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
  const res = await fetch("/api/instruments/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<InstrumentLookupResponse>;
}

export function isLookupError(
  res: InstrumentLookupResponse
): res is InstrumentLookupFail {
  return !("success" in res && res.success === true);
}
