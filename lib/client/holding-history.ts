/**
 * 單一持倉歷史價格抓取（基金集保 / 上市 TWSE）
 */

import type { ChartRange } from "@/lib/portfolio/chart-date-range";
import type { Holding, PricePoint } from "@/lib/types/holding";
import {
  fetchFundNavHistory,
  fetchStockPriceHistory,
  isHistoryError,
  isStockHistoryError,
} from "./price-api";

/** 是否可自動載入歷史（上櫃股票除外） */
export function canImportHistory(holding: Holding): boolean {
  if (holding.assetType === "fund") return true;
  return holding.market !== "otc";
}

export async function fetchHoldingHistoryPoints(
  holding: Holding,
  range: ChartRange
): Promise<PricePoint[]> {
  if (holding.assetType === "fund") {
    const res = await fetchFundNavHistory({
      fundCode: holding.symbol,
      range,
      buyDate: holding.buyDate,
    });
    if (isHistoryError(res)) {
      throw new Error(res.error);
    }
    return res.data.points.map((p) => ({
      date: p.date,
      price: p.nav,
      source: "api" as const,
    }));
  }

  if (holding.market === "otc") {
    throw new Error("上櫃股票暫不支援自動載入歷史股價");
  }

  const res = await fetchStockPriceHistory({
    symbol: holding.symbol,
    market: holding.market ?? "tse",
    range,
    buyDate: holding.buyDate,
  });

  if (isStockHistoryError(res)) {
    throw new Error(res.error);
  }

  return res.data.points.map((p) => ({
    date: p.date,
    price: p.price,
    source: "api" as const,
  }));
}
