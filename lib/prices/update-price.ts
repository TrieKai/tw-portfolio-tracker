/**
 * 統一價格更新函式 updatePrice()
 * 依 assetType 分派至股票（TWSE）或基金（集保 fundclear）抓取器。
 */

import { fetchFundNav, FundNavFetchError } from "@/lib/fund-nav/fetcher";
import { getCachedFundNav, setCachedFundNav } from "@/lib/fund-nav/cache";
import type { AssetType, StockMarket } from "@/lib/types/holding";
import type { UpdatePriceSuccess } from "@/lib/types/price-api";
import { fetchStockPrice } from "./stock-fetcher";
import { FetchRetryError } from "@/lib/http/fetch-with-retry";

export interface UpdatePriceParams {
  assetType: AssetType;
  symbol: string;
  market?: StockMarket;
  name?: string;
  /** 略過伺服器快取，強制重新抓取 */
  skipCache?: boolean;
}

export class UpdatePriceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "UpdatePriceError";
  }
}

/**
 * 更新單一標的價格（股票或基金）
 * @throws UpdatePriceError
 */
export async function updatePrice(
  params: UpdatePriceParams
): Promise<UpdatePriceSuccess> {
  const { assetType, symbol, market, name, skipCache = false } = params;

  if (assetType === "stock") {
    try {
      const data = await fetchStockPrice(symbol, market);
      return {
        success: true,
        assetType: "stock",
        symbol: data.symbol,
        name: data.name,
        price: data.price,
        priceDate: data.priceDate,
        currency: data.currency,
        changePercent: data.changePercent,
        market: data.market,
        source: "twse",
      };
    } catch (error) {
      if (error instanceof FetchRetryError) {
        throw new UpdatePriceError(error.message, error.code, error.statusCode);
      }
      throw error;
    }
  }

  if (assetType === "fund") {
    const fundCode = symbol.replace(/\D/g, "");
    if (!fundCode) {
      throw new UpdatePriceError("基金代碼不可為空", "VALIDATION_ERROR");
    }

    if (!skipCache) {
      const cached = await getCachedFundNav(fundCode);
      if (cached) {
        return {
          success: true,
          assetType: "fund",
          symbol: fundCode,
          name: cached.fundName,
          price: cached.nav,
          priceDate: cached.navDate,
          currency: cached.currency,
          changePercent: cached.navChangePercent,
          source: "cache",
        };
      }
    }

    try {
      const data = await fetchFundNav(fundCode, name);
      await setCachedFundNav(fundCode, data);
      return {
        success: true,
        assetType: "fund",
        symbol: fundCode,
        name: data.fundName,
        price: data.nav,
        priceDate: data.navDate,
        currency: data.currency,
        changePercent: data.navChangePercent,
        source: "fundclear",
      };
    } catch (error) {
      if (error instanceof FundNavFetchError) {
        throw new UpdatePriceError(
          error.message,
          error.code,
          error.statusCode
        );
      }
      throw error;
    }
  }

  throw new UpdatePriceError(`不支援的資產類型：${assetType}`, "INVALID_ASSET_TYPE");
}
