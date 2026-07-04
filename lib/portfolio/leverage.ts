/**
 * 槓桿倍數推斷（台股槓桿／反向 ETF）
 * ----------------------------------------
 * 曝險金額 = 部位市值 × 槓桿倍數
 * 一般標的預設 1 倍；代號尾碼 L 多為正 2、R 多為反 1（曝險仍計 1 倍名目）。
 */

import { normalizeStockSymbol } from "@/lib/prices/stock-symbol";
import type { Holding } from "@/lib/types/holding";

export type LeverageSource = "manual" | "name" | "symbol" | "default";

export interface ResolvedLeverage {
  /** 用於曝險金額計算的正數倍數 */
  multiplier: number;
  source: LeverageSource;
  /** 是否為反向型（僅供 UI 標示） */
  isInverse: boolean;
}

/** 從名稱解析「正 2／反 1」等倍數 */
function parseLeverageFromName(name: string): number | null {
  const positive = name.match(/正\s*([23２３])/);
  if (positive) {
    const digit = positive[1].replace("２", "2").replace("３", "3");
    return Number(digit);
  }

  const inverse = name.match(/反\s*([12１２])/);
  if (inverse) {
    const digit = inverse[1].replace("１", "1").replace("２", "2");
    return Number(digit);
  }

  return null;
}

function inferFromSymbol(symbol: string): ResolvedLeverage | null {
  const norm = normalizeStockSymbol(symbol);
  if (/L$/i.test(norm)) {
    return { multiplier: 2, source: "symbol", isInverse: false };
  }
  if (/R$/i.test(norm)) {
    return { multiplier: 1, source: "symbol", isInverse: true };
  }
  return null;
}

/** 解析持倉槓桿倍數（曝險計算用，一律回傳正數） */
export function resolveLeverage(
  holding: Pick<Holding, "assetType" | "symbol" | "name" | "leverageMultiplier">
): ResolvedLeverage {
  if (
    holding.leverageMultiplier !== undefined &&
    holding.leverageMultiplier > 0
  ) {
    return {
      multiplier: holding.leverageMultiplier,
      source: "manual",
      isInverse: false,
    };
  }

  if (holding.assetType !== "stock") {
    return { multiplier: 1, source: "default", isInverse: false };
  }

  const fromName = parseLeverageFromName(holding.name);
  if (fromName !== null) {
    const isInverse = /反/.test(holding.name);
    return { multiplier: fromName, source: "name", isInverse };
  }

  const fromSymbol = inferFromSymbol(holding.symbol);
  if (fromSymbol) return fromSymbol;

  return { multiplier: 1, source: "default", isInverse: false };
}
