/**
 * 投資曝險計算
 * ----------------------------------------
 * 曝險金額 = 部位市值 × 槓桿倍數
 * 曝險比例 = 實際總曝險部位 ÷ 淨資產 × 100%
 * 淨資產（未直接指定時）= 持倉市值 − 房貸餘額 − 投資負債
 */

import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { resolveLeverage } from "@/lib/portfolio/leverage";
import type {
  AssetType,
  Holding,
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
  /** 房貸餘額（僅 property） */
  mortgageBalance?: number;
}

export interface PortfolioExposureSummary {
  totalMarketValue: number;
  totalExposure: number;
  /** 淨資產（自有資金） */
  netAssets: number;
  /** 曝險比例（%）；淨資產為 0 時為 null */
  exposureRatioPct: number | null;
  /** 投資負債（settings.liabilities） */
  investmentLiabilities: number;
  /** 各房產房貸餘額加總 */
  propertyMortgages: number;
  /** 總負債 = 投資負債 + 房貸 */
  totalLiabilities: number;
  /** 是否使用 settings.netAssets 直接指定 */
  usesNetAssetsOverride: boolean;
  rows: HoldingExposureRow[];
}

/** 加總各房產的房貸餘額 */
export function sumPropertyMortgages(
  holdings: Pick<Holding, "assetType" | "mortgageBalance">[]
): number {
  return holdings.reduce((sum, h) => {
    if (h.assetType !== "property") return sum;
    const balance = h.mortgageBalance ?? 0;
    return balance > 0 ? sum + balance : sum;
  }, 0);
}

/** 解析淨資產：優先 netAssets，否則 持倉市值 − 房貸 − 投資負債 */
export function resolveNetAssets(
  totalMarketValue: number,
  settings: Pick<PortfolioSettings, "netAssets" | "liabilities">,
  propertyMortgages = 0
): {
  netAssets: number;
  usesOverride: boolean;
  investmentLiabilities: number;
  propertyMortgages: number;
  totalLiabilities: number;
} {
  const investmentLiabilities = settings.liabilities ?? 0;
  const totalLiabilities = investmentLiabilities + propertyMortgages;

  if (settings.netAssets !== undefined && settings.netAssets >= 0) {
    return {
      netAssets: settings.netAssets,
      usesOverride: true,
      investmentLiabilities,
      propertyMortgages,
      totalLiabilities,
    };
  }

  return {
    netAssets: Math.max(0, totalMarketValue - totalLiabilities),
    usesOverride: false,
    investmentLiabilities,
    propertyMortgages,
    totalLiabilities,
  };
}

export function computePortfolioExposure(
  holdings: HoldingWithMetrics[],
  settings: Pick<PortfolioSettings, "netAssets" | "liabilities"> = {}
): PortfolioExposureSummary {
  const groups = groupHoldingsWithMetrics(holdings);
  const propertyMortgages = sumPropertyMortgages(holdings);
  const rows: HoldingExposureRow[] = [];
  let totalMarketValue = 0;
  let totalExposure = 0;

  for (const g of groups) {
    const { multiplier, isInverse } = resolveLeverage(g);
    const exposureAmount = g.marketValue * multiplier;
    totalMarketValue += g.marketValue;
    totalExposure += exposureAmount;

    const mortgageBalance =
      g.assetType === "property"
        ? g.lots[0]?.mortgageBalance
        : undefined;

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
      mortgageBalance:
        mortgageBalance !== undefined && mortgageBalance > 0
          ? mortgageBalance
          : undefined,
    });
  }

  rows.sort((a, b) => b.exposureAmount - a.exposureAmount);

  if (totalExposure > 0) {
    for (const row of rows) {
      row.exposureSharePct = (row.exposureAmount / totalExposure) * 100;
    }
  }

  const resolved = resolveNetAssets(
    totalMarketValue,
    settings,
    propertyMortgages
  );

  const exposureRatioPct =
    resolved.netAssets > 0 ? (totalExposure / resolved.netAssets) * 100 : null;

  return {
    totalMarketValue,
    totalExposure,
    netAssets: resolved.netAssets,
    exposureRatioPct,
    investmentLiabilities: resolved.investmentLiabilities,
    propertyMortgages: resolved.propertyMortgages,
    totalLiabilities: resolved.totalLiabilities,
    usesNetAssetsOverride: resolved.usesOverride,
    rows,
  };
}

/** 曝險比例顯示（例：300%） */
export function formatExposureRatio(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(0)}%`;
}
