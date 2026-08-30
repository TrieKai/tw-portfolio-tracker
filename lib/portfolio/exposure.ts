/**
 * 投資曝險計算
 * ----------------------------------------
 * 曝險金額 = 部位市值 × 槓桿倍數
 * 曝險比例 = 實際總曝險部位 ÷ 淨資產 × 100%
 * 淨資產（未直接指定時）= 持倉市值 − 房貸本金 − 投資用途貸款本金
 */

import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { resolveLeverage } from "@/lib/portfolio/leverage";
import { calculateLoanSnapshot } from "@/lib/loans/calculations";
import { todayIsoDate } from "@/lib/date/iso-date";
import type {
  AssetType,
  Holding,
  HoldingWithMetrics,
  PortfolioSettings,
} from "@/lib/types/holding";
import type { Loan } from "@/lib/types/loan";

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
  /** 投資用途貸款本金。 */
  investmentLiabilities: number;
  /** 各房產房貸餘額加總 */
  propertyMortgages: number;
  /** 所有貸款本金，包含不影響投資組合的個人用途貸款。 */
  totalLiabilities: number;
  personalLiabilities: number;
  /** 是否使用 settings.netAssets 直接指定 */
  usesNetAssetsOverride: boolean;
  rows: HoldingExposureRow[];
}

/** 加總指定日期仍未清償的房貸本金。 */
export function sumPropertyMortgages(
  loans: Loan[],
  asOfDate: string = todayIsoDate()
): number {
  return loans.reduce((sum, loan) => {
    if (loan.purpose !== "property") return sum;
    return sum + calculateLoanSnapshot(loan, asOfDate).currentPrincipal;
  }, 0);
}

/** 解析投資組合淨資產；個人消費用途負債不混入投資曝險分母。 */
export function resolveNetAssets(
  totalMarketValue: number,
  settings: Pick<PortfolioSettings, "netAssets">,
  investmentLiabilities = 0,
  propertyMortgages = 0,
  totalLiabilities = investmentLiabilities + propertyMortgages
): {
  netAssets: number;
  usesOverride: boolean;
  investmentLiabilities: number;
  propertyMortgages: number;
  totalLiabilities: number;
} {
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
    netAssets: Math.max(
      0,
      totalMarketValue - investmentLiabilities - propertyMortgages
    ),
    usesOverride: false,
    investmentLiabilities,
    propertyMortgages,
    totalLiabilities,
  };
}

export function computePortfolioExposure(
  holdings: HoldingWithMetrics[],
  settings: Pick<PortfolioSettings, "netAssets"> = {},
  loans: Loan[] = [],
  asOfDate: string = todayIsoDate()
): PortfolioExposureSummary {
  const groups = groupHoldingsWithMetrics(holdings);
  const loanSnapshots = loans.map((loan) => calculateLoanSnapshot(loan, asOfDate));
  const propertyMortgages = sumPropertyMortgages(loans, asOfDate);
  const totalLiabilities = loanSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.currentPrincipal,
    0
  );
  const investmentLiabilities = loanSnapshots.reduce((sum, snapshot) => {
    const share = Math.min(100, Math.max(0, snapshot.loan.investmentUsePercent)) / 100;
    return sum + snapshot.currentPrincipal * share;
  }, 0);
  const rows: HoldingExposureRow[] = [];
  let totalMarketValue = 0;
  let totalExposure = 0;

  for (const g of groups) {
    const { multiplier, isInverse } = resolveLeverage(g);
    const exposureAmount = g.marketValue * multiplier;
    totalMarketValue += g.marketValue;
    totalExposure += exposureAmount;

    const holdingIds = new Set(g.lots.map((lot) => lot.id));
    const mortgageBalance =
      g.assetType === "property"
        ? loanSnapshots.reduce(
            (sum, snapshot) =>
              snapshot.loan.purpose === "property" &&
              snapshot.loan.linkedHoldingId &&
              holdingIds.has(snapshot.loan.linkedHoldingId)
                ? sum + snapshot.currentPrincipal
                : sum,
            0
          )
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
    investmentLiabilities,
    propertyMortgages,
    totalLiabilities
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
    personalLiabilities: Math.max(
      0,
      totalLiabilities - investmentLiabilities - propertyMortgages
    ),
    usesNetAssetsOverride: resolved.usesOverride,
    rows,
  };
}

/** 曝險比例顯示（例：300%） */
export function formatExposureRatio(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(0)}%`;
}
