/**
 * 依代號查詢標的官方名稱（台股 TWSE / 基金集保）
 */

import { fetchFundNav, FundNavFetchError } from "@/lib/fund-nav/fetcher";
import { getCachedFundNav } from "@/lib/fund-nav/cache";
import type { AssetType, StockMarket } from "@/lib/types/holding";
import { fetchStockPrice } from "./stock-fetcher";
import { FetchRetryError } from "@/lib/http/fetch-with-retry";
import { normalizeStockSymbol } from "./stock-symbol";

export interface LookupInstrumentParams {
  assetType: AssetType;
  symbol: string;
  market?: StockMarket;
}

export interface LookupInstrumentResult {
  name: string;
  symbol: string;
  assetType: AssetType;
  market?: StockMarket;
}

export class LookupInstrumentError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "LookupInstrumentError";
  }
}

export async function lookupInstrumentName(
  params: LookupInstrumentParams
): Promise<LookupInstrumentResult> {
  const { assetType, market } = params;

  if (assetType === "stock") {
    try {
      const data = await fetchStockPrice(params.symbol, market);
      return {
        name: data.name.trim() || data.symbol,
        symbol: data.symbol,
        assetType: "stock",
        market: data.market,
      };
    } catch (error) {
      if (error instanceof FetchRetryError) {
        throw new LookupInstrumentError(error.message, error.code);
      }
      throw error;
    }
  }

  if (assetType === "fund") {
    const fundCode = params.symbol.replace(/\D/g, "");
    if (!fundCode) {
      throw new LookupInstrumentError("基金代碼不可為空", "VALIDATION_ERROR");
    }

    const cached = await getCachedFundNav(fundCode);
    if (cached?.fundName) {
      return {
        name: cached.fundName,
        symbol: fundCode,
        assetType: "fund",
      };
    }

    try {
      const data = await fetchFundNav(fundCode);
      return {
        name: data.fundName,
        symbol: fundCode,
        assetType: "fund",
      };
    } catch (error) {
      if (error instanceof FundNavFetchError) {
        throw new LookupInstrumentError(error.message, error.code);
      }
      throw error;
    }
  }

  throw new LookupInstrumentError(
    `不支援的資產類型：${assetType}`,
    "INVALID_ASSET_TYPE"
  );
}

/** 正規化代號（與儲存邏輯一致） */
export function normalizeSymbolForAsset(
  assetType: AssetType,
  symbol: string
): string {
  return assetType === "fund"
    ? symbol.replace(/\D/g, "")
    : normalizeStockSymbol(symbol);
}
