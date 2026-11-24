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

type LookupParams = { assetType: AssetType; symbol: string; market?: StockMarket };
const resolved = new Map<string, { response: InstrumentLookupSuccess; expiresAt: number }>();
const inFlight = new Map<string, Promise<InstrumentLookupResponse>>();

export function lookupInstrument(params: LookupParams): Promise<InstrumentLookupResponse> {
  const symbol = params.symbol.trim().toUpperCase();
  const key = `${params.assetType}:${symbol}:${params.market ?? ""}`;
  const cached = resolved.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.response);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = requestInstrument({ ...params, symbol }).then((response) => {
    if (response.success) {
      resolved.delete(key);
      resolved.set(key, { response, expiresAt: Date.now() + 5 * 60_000 });
      const oldest = resolved.keys().next().value;
      if (resolved.size > 50 && oldest) resolved.delete(oldest);
    }
    return response;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function requestInstrument(params: LookupParams): Promise<InstrumentLookupResponse> {
  try {
    const res = await fetch("/api/instruments/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(25_000),
    });
    const response = (await res.json()) as InstrumentLookupResponse | null;
    if (response && typeof response.success === "boolean") return response;
    throw new Error("INVALID_LOOKUP_RESPONSE");
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
