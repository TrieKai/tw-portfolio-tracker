import { parseIsoDate } from "@/lib/date/iso-date";
import { calculateLoanSnapshot } from "@/lib/loans/calculations";
import type { Holding } from "@/lib/types/holding";
import type {
  Loan,
  LoanCollateralValuation,
  LoanRiskLevel,
  PortfolioLoanRiskSummary,
} from "@/lib/types/loan";

const MS_PER_DAY = 86_400_000;

export function hasCollateralRisk(loan: Loan): boolean {
  return (
    loan.loanType === "securities_margin" ||
    loan.loanType === "securities_pledge"
  );
}

export function hasFlexibleCredit(loan: Loan): boolean {
  return (
    hasCollateralRisk(loan) || loan.loanType === "revolving_credit"
  );
}

function daysUntil(fromDate: string, toDate?: string): number | null {
  if (!toDate) return null;
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return null;
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function priceDropBuffer(
  ratio: number | null,
  threshold?: number
): number | null {
  if (ratio === null || ratio <= 0 || !threshold || threshold <= 0) {
    return null;
  }
  return Math.max(0, (1 - threshold / ratio) * 100);
}

function collateralRiskLevel(options: {
  secured: boolean;
  principal: number;
  ratio: number | null;
  missingPositionCount: number;
  warningThreshold?: number;
  callThreshold?: number;
  daysToMaturity: number | null;
}): LoanRiskLevel {
  const {
    secured,
    principal,
    ratio,
    missingPositionCount,
    warningThreshold,
    callThreshold,
    daysToMaturity,
  } = options;

  if (principal <= 0) return "safe";
  if (daysToMaturity !== null && daysToMaturity < 0) return "critical";
  if (
    secured &&
    ratio !== null &&
    callThreshold !== undefined &&
    ratio <= callThreshold
  ) {
    return "critical";
  }
  if (daysToMaturity !== null && daysToMaturity <= 30) return "warning";
  if (
    secured &&
    ratio !== null &&
    warningThreshold !== undefined &&
    ratio <= warningThreshold
  ) {
    return "warning";
  }
  if (!secured) return "not_applicable";
  if (
    ratio === null ||
    missingPositionCount > 0 ||
    warningThreshold === undefined ||
    callThreshold === undefined
  ) {
    return "unknown";
  }
  return "safe";
}

/**
 * 維持率 = 擔保品目前市值 ÷ 目前本金。只有有效最新價格才納入；
 * 缺價時標示未知，不以成本價冒充市價。
 */
export function calculateLoanCollateralValuation(
  loan: Loan,
  holdings: Holding[],
  asOfDate: string
): LoanCollateralValuation {
  const principal = calculateLoanSnapshot(loan, asOfDate).currentPrincipal;
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  let trackedCollateralValue = 0;
  let missingPositionCount = 0;

  for (const position of loan.collateralPositions ?? []) {
    const holding = holdingById.get(position.holdingId);
    if (
      !holding ||
      holding.assetType === "property" ||
      !holding.currentPrice ||
      holding.currentPrice <= 0 ||
      position.quantity <= 0
    ) {
      missingPositionCount += 1;
      continue;
    }
    const recognizedQuantity = Math.min(position.quantity, holding.quantity);
    trackedCollateralValue += holding.currentPrice * recognizedQuantity;
    if (position.quantity > holding.quantity) missingPositionCount += 1;
  }

  const manualCollateralValue = Math.max(0, loan.manualCollateralValue ?? 0);
  const collateralMarketValue = trackedCollateralValue + manualCollateralValue;
  const secured = hasCollateralRisk(loan);
  const maintenanceRatioPercent =
    secured && principal > 0 && collateralMarketValue > 0
      ? (collateralMarketValue / principal) * 100
      : null;
  const creditLimit = loan.creditLimit;
  const creditUtilizationPercent =
    creditLimit !== undefined && creditLimit > 0
      ? (principal / creditLimit) * 100
      : null;
  const daysToMaturity = daysUntil(asOfDate, loan.maturityDate);
  const riskLevel = collateralRiskLevel({
    secured,
    principal,
    ratio: maintenanceRatioPercent,
    missingPositionCount,
    warningThreshold: loan.maintenanceWarningPercent,
    callThreshold: loan.maintenanceCallPercent,
    daysToMaturity,
  });

  return {
    loanId: loan.id,
    collateralMarketValue,
    trackedCollateralValue,
    manualCollateralValue,
    missingPositionCount,
    maintenanceRatioPercent,
    warningBufferPercent: priceDropBuffer(
      maintenanceRatioPercent,
      loan.maintenanceWarningPercent
    ),
    callBufferPercent: priceDropBuffer(
      maintenanceRatioPercent,
      loan.maintenanceCallPercent
    ),
    creditUtilizationPercent,
    availableCredit:
      creditLimit !== undefined ? Math.max(0, creditLimit - principal) : null,
    daysToMaturity,
    riskLevel,
    usesManualCollateralValue: manualCollateralValue > 0,
  };
}

export function calculatePortfolioLoanRiskSummary(
  loans: Loan[],
  holdings: Holding[],
  asOfDate: string
): PortfolioLoanRiskSummary {
  const monitoredLoans = loans.filter(
    (loan) =>
      hasFlexibleCredit(loan) &&
      loan.trackingStartDate <= asOfDate &&
      (!loan.closedAt || loan.closedAt > asOfDate)
  );
  const valuations = monitoredLoans.map((loan) =>
    calculateLoanCollateralValuation(loan, holdings, asOfDate)
  );
  const ratios = valuations
    .map((valuation) => valuation.maintenanceRatioPercent)
    .filter((ratio): ratio is number => ratio !== null);
  const maturityDates = monitoredLoans
    .map((loan) => loan.maturityDate)
    .filter((date): date is string => !!date && date >= asOfDate)
    .sort();

  return {
    monitoredLoanCount: monitoredLoans.length,
    criticalCount: valuations.filter(
      (valuation) => valuation.riskLevel === "critical"
    ).length,
    warningCount: valuations.filter(
      (valuation) => valuation.riskLevel === "warning"
    ).length,
    unknownCount: valuations.filter(
      (valuation) => valuation.riskLevel === "unknown"
    ).length,
    lowestMaintenanceRatioPercent:
      ratios.length > 0 ? Math.min(...ratios) : null,
    nextMaturityDate: maturityDates[0] ?? null,
    totalCollateralMarketValue: valuations.reduce(
      (sum, valuation) => sum + valuation.collateralMarketValue,
      0
    ),
  };
}
