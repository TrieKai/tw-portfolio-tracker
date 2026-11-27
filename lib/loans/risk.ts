import { parseIsoDate } from "@/lib/date/iso-date";
import { calculateLoanSnapshot } from "@/lib/loans/calculations";
import { collateralQuantityOn } from "@/lib/loans/collateral";
import { isLoanOpenAt } from "@/lib/loans/history";
import { loansWithConsistentPhases } from "@/lib/loans/phases";
import { quantityAvailability } from "@/lib/portfolio/quantity";
import type { CorporateActionRecord, Holding } from "@/lib/types/holding";
import type {
  Loan,
  LoanCollateralOverlap,
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

function collateralQuantities(
  loan: Loan,
  holdingById: ReadonlyMap<string, Holding>,
  date: string,
  corporateActions: CorporateActionRecord[]
): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const position of loan.collateralPositions ?? []) {
    const holding = holdingById.get(position.holdingId);
    const quantity = holding
      ? collateralQuantityOn(position, holding, corporateActions, date, loan.contractUpdatedAt ?? loan.createdAt)
      : position.quantity;
    const previous = quantities.get(position.holdingId) ?? 0;
    quantities.set(position.holdingId, quantity > 0 ? previous + quantity : NaN);
  }
  return quantities;
}

function valueLoanCollateral(
  loan: Loan,
  holdingById: ReadonlyMap<string, Holding>,
  quantities: ReadonlyMap<string, number>,
  asOfDate: string,
  overlaps?: ReadonlyMap<string, LoanCollateralOverlap>
): LoanCollateralValuation {
  const principal = calculateLoanSnapshot(loan, asOfDate).currentPrincipal;
  let trackedCollateralValue = 0;
  let missingPositionCount = 0;
  let overlappingPositionCount = 0;

  for (const [holdingId, quantity] of quantities) {
    if (overlaps?.get(holdingId)?.loanIds.includes(loan.id)) {
      overlappingPositionCount += 1;
      continue;
    }
    const holding = holdingById.get(holdingId);
    if (
      !holding ||
      holding.assetType === "property" ||
      !holding.currentPrice ||
      holding.currentPrice <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0
    ) {
      missingPositionCount += 1;
      continue;
    }
    const recognizedQuantity = Math.min(quantity, holding.quantity);
    trackedCollateralValue += holding.currentPrice * recognizedQuantity;
    if (!quantityAvailability(quantity, holding.quantity)) missingPositionCount += 1;
  }

  const manualCollateralValue = Math.max(0, loan.manualCollateralValue ?? 0);
  const collateralMarketValue = trackedCollateralValue + manualCollateralValue;
  const secured = hasCollateralRisk(loan);
  // 可核對的部分市值仍可顯示，但資料不全時不以部分市值判斷是否達到追繳門檻。
  const maintenanceRatioPercent =
    secured && overlappingPositionCount === 0 && missingPositionCount === 0 && principal > 0 && collateralMarketValue > 0
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
    overlappingPositionCount,
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

/** 各筆擔保數量先換成估值日股數。同一持倉的可用股數在組合中只計一次。 */
export function calculatePortfolioLoanRisk(
  loans: Loan[],
  holdings: Holding[],
  asOfDate: string,
  corporateActions: CorporateActionRecord[] = []
) {
  const monitoredLoans = loansWithConsistentPhases(loans).filter(
    (loan) =>
      hasFlexibleCredit(loan) && isLoanOpenAt(loan, asOfDate)
  );
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const quantitiesByLoan = new Map(monitoredLoans.map((loan) => [
    loan.id, collateralQuantities(loan, holdingById, asOfDate, corporateActions),
  ]));
  const claims = new Map<string, { quantity: number; loanIds: string[] }>();
  for (const loan of monitoredLoans) {
    if (!hasCollateralRisk(loan)) continue;
    for (const [id, quantity] of quantitiesByLoan.get(loan.id) ?? []) {
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const claimed = claims.get(id) ?? { quantity: 0, loanIds: [] };
      claimed.quantity += quantity;
      claimed.loanIds.push(loan.id);
      claims.set(id, claimed);
    }
  }
  const overlaps = new Map<string, LoanCollateralOverlap>();
  let trackedCollateralValue = 0;
  for (const [id, { quantity, loanIds }] of claims) {
    const holding = holdingById.get(id);
    if (!holding || holding.assetType === "property") continue;
    if (loanIds.length > 1 && !quantityAvailability(quantity, holding.quantity)) {
      overlaps.set(id, { holdingId: id, requestedQuantity: quantity, availableQuantity: holding.quantity, loanIds });
    }
    if (holding.currentPrice && holding.currentPrice > 0) {
      trackedCollateralValue += Math.min(quantity, holding.quantity) * holding.currentPrice;
    }
  }

  const valuations = monitoredLoans.map((loan) =>
    valueLoanCollateral(loan, holdingById, quantitiesByLoan.get(loan.id)!, asOfDate, overlaps));
  const ratios = valuations
    .map((valuation) => valuation.maintenanceRatioPercent)
    .filter((ratio): ratio is number => ratio !== null);
  const maturityDates = monitoredLoans
    .map((loan) => loan.maturityDate)
    .filter((date): date is string => !!date && date >= asOfDate)
    .sort();

  const summary: PortfolioLoanRiskSummary = {
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
    totalCollateralMarketValue: trackedCollateralValue + valuations.reduce(
      (sum, valuation) => sum + valuation.manualCollateralValue,
      0
    ),
    collateralOverlaps: [...overlaps.values()],
  };
  return { summary, valuations: new Map(valuations.map((valuation) => [valuation.loanId, valuation])) };
}

/** 供單一獨立貸款或已結束的契約檢視。 */
export function calculateLoanCollateralValuation(
  loan: Loan,
  holdings: Holding[],
  asOfDate: string,
  corporateActions: CorporateActionRecord[] = []
): LoanCollateralValuation {
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  return valueLoanCollateral(loan, holdingById, collateralQuantities(loan, holdingById, asOfDate, corporateActions), asOfDate);
}

export function calculatePortfolioLoanRiskSummary(
  loans: Loan[],
  holdings: Holding[],
  asOfDate: string,
  corporateActions: CorporateActionRecord[] = []
): PortfolioLoanRiskSummary {
  return calculatePortfolioLoanRisk(loans, holdings, asOfDate, corporateActions).summary;
}
