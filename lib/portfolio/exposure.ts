/**
 * 投資曝險計算
 * ----------------------------------------
 * 曝險金額 = 部位市值 × 槓桿倍數
 * 曝險比例 = 實際總曝險部位 ÷ 淨資產 × 100%
 */

import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { resolveLeverage } from "@/lib/portfolio/leverage";
import type {
  AssetType,
  HoldingWithMetrics,
  PortfolioSettings,
} from "@/lib/types/holding";

export interface HoldingExposureRow {
  groupKey: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  marketValue: number;
  leverage: number;
  isInverse: boolean;
  /** 市值 × 槓桿倍數 */
  exposureAmount: number;
  /** 佔投資組合總曝險的比例 */
  exposureSharePct: number;
}

export interface PortfolioExposureSummary {
  totalMarketValue: number;
  totalExposure: number;
  /** 淨資產（自有資金） */
  netAssets: number;
  /** 曝險比例（%）；淨資產為 0 時為 null */
  exposureRatioPct: number | null;
  liabilities: number;
  /** 是否使用 settings.netAssets 直接指定 */
  usesNetAssetsOverride: boolean;
  rows: HoldingExposureRow[];
}

/** 解析淨資產：優先使用 netAssets，否則 持倉市值 − 投資負債 */
export function resolveNetAssets(
  totalMarketValue: number,
  settings: Pick<PortfolioSettings, "netAssets" | "liabilities">
): { netAssets: number; usesOverride: boolean; liabilities: number } {
  const liabilities = settings.liabilities ?? 0;

  if (settings.netAssets !== undefined && settings.netAssets >= 0) {
    return {
      netAssets: settings.netAssets,
      usesOverride: true,
      liabilities,
    };
  }

  return {
    netAssets: Math.max(0, totalMarketValue - liabilities),
    usesOverride: false,
    liabilities,
  };
}

export function computePortfolioExposure(
  holdings: HoldingWithMetrics[],
  settings: Pick<PortfolioSettings, "netAssets" | "liabilities"> = {}
): PortfolioExposureSummary {
  const groups = groupHoldingsWithMetrics(holdings);
  const rows: HoldingExposureRow[] = [];
  let totalMarketValue = 0;
  let totalExposure = 0;

  for (const g of groups) {
    const { multiplier, isInverse } = resolveLeverage(g);
    const exposureAmount = g.marketValue * multiplier;
    totalMarketValue += g.marketValue;
    totalExposure += exposureAmount;

    rows.push({
      groupKey: g.groupKey,
      name: g.name,
      symbol: g.symbol,
      assetType: g.assetType,
      marketValue: g.marketValue,
      leverage: multiplier,
      isInverse,
      exposureAmount,
      exposureSharePct: 0,
    });
  }

  rows.sort((a, b) => b.exposureAmount - a.exposureAmount);

  if (totalExposure > 0) {
    for (const row of rows) {
      row.exposureSharePct = (row.exposureAmount / totalExposure) * 100;
    }
  }

  const { netAssets, usesOverride, liabilities } = resolveNetAssets(
    totalMarketValue,
    settings
  );

  const exposureRatioPct =
    netAssets > 0 ? (totalExposure / netAssets) * 100 : null;

  return {
    totalMarketValue,
    totalExposure,
    netAssets,
    exposureRatioPct,
    liabilities,
    usesNetAssetsOverride: usesOverride,
    rows,
  };
}

/** 曝險比例顯示（例：300%） */
export function formatExposureRatio(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(0)}%`;
}
