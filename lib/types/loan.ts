export const LOAN_TYPES = [
  "personal_credit",
  "securities_margin",
  "securities_pledge",
  "mortgage",
  "home_equity",
  "policy",
  "revolving_credit",
  "private",
  "other",
] as const;

export type LoanType = (typeof LOAN_TYPES)[number];

export type LoanPurpose = "investment" | "property" | "personal" | "mixed";
export type LoanRateType = "fixed" | "floating";
export type LoanRepaymentMethod =
  | "equal_payment"
  | "equal_principal"
  | "interest_only"
  | "bullet"
  | "revolving";
export type LoanStatus = "active" | "paid_off" | "refinanced";
export type LoanDataQuality = "complete" | "estimated" | "incomplete";

/** 以投資組合內的一筆持倉作為融資／質押擔保品。 */
export interface LoanCollateralPosition {
  holdingId: string;
  /** 實際設質或融資的股數／基金單位數，不必等於整筆持倉。 */
  quantity: number;
}

/** 隨借隨還或提前還本後的本金快照；同日以最後一次輸入為準。 */
export interface LoanBalanceSnapshot {
  effectiveDate: string;
  balance: number;
  recordedAt: string;
}

/**
 * 一筆獨立貸款契約。openingBalance 是 trackingStartDate 當日的本金快照；
 * 這個基準讓既有貸款不必捏造追蹤前的本金與利息。
 */
export interface Loan {
  id: string;
  name: string;
  lender?: string;
  loanType: LoanType;
  purpose: LoanPurpose;
  /** 0–100；只有這個比例的本金與融資成本影響投資績效。 */
  investmentUsePercent: number;
  linkedHoldingId?: string;
  openingBalance: number;
  trackingStartDate: string;
  /** 自追蹤起點起算的剩餘期數；隨借隨還或待補資料可省略。 */
  remainingTermMonths?: number;
  firstPaymentDate?: string;
  annualInterestRate: number;
  rateType: LoanRateType;
  repaymentMethod: LoanRepaymentMethod;
  gracePeriodMonths?: number;
  /** 完整建立模式才保存原契約資訊。 */
  originalPrincipal?: number;
  contractStartDate?: string;
  originalTermMonths?: number;
  /** 支付日視為 trackingStartDate；第一階段採支付日一次認列。 */
  initialFees?: number;
  accountLastFour?: string;
  /** 循環額度、融資或質押契約的最高可動用本金。 */
  creditLimit?: number;
  /** 契約到期日；無固定到期日可省略。 */
  maturityDate?: string;
  /** 契約約定的提早警示與追繳維持率，不預設券商／銀行規則。 */
  maintenanceWarningPercent?: number;
  maintenanceCallPercent?: number;
  /** 連結投資組合內的擔保品；市值使用持倉最新價格。 */
  collateralPositions?: LoanCollateralPosition[];
  /** 未納入本投資組合的外部擔保品市值，視為手動估值。 */
  manualCollateralValue?: number;
  /** openingBalance 之後的本金變動，避免更正目前餘額時回寫歷史。 */
  balanceHistory?: LoanBalanceSnapshot[];
  status: LoanStatus;
  closedAt?: string;
  dataQuality: LoanDataQuality;
  createdAt: string;
  updatedAt: string;
}

export type CreateLoanInput = Omit<
  Loan,
  "id" | "status" | "closedAt" | "createdAt" | "updatedAt"
>;

export type EditLoanInput = CreateLoanInput & { id: string };

export interface LoanRevision {
  id: string;
  loanId: string;
  previous: Loan;
  correctedAt: string;
}

export interface LoanScheduleRow {
  installment: number;
  paymentDate: string;
  openingPrincipal: number;
  principal: number;
  interest: number;
  payment: number;
  remainingPrincipal: number;
}

export interface LoanSnapshot {
  loan: Loan;
  currentPrincipal: number;
  schedule: LoanScheduleRow[];
  nextPayment: LoanScheduleRow | null;
  estimatedInterestToDate: number;
  estimatedFinancingCostToDate: number;
  projectedInterest: number | null;
  projectedTotalPayment: number | null;
}

export interface PortfolioLoanSummary {
  activeLoanCount: number;
  totalDebt: number;
  investmentDebt: number;
  propertyDebt: number;
  personalDebt: number;
  estimatedInterestToDate: number;
  investmentFinancingCostToDate: number;
  monthlyInvestmentFinancingCost: number;
  nextPaymentDate: string | null;
  nextPaymentAmount: number;
  grossInvestmentPnl: number;
  netInvestmentPnl: number;
  hasIncompleteData: boolean;
}

export type LoanRiskLevel =
  | "safe"
  | "warning"
  | "critical"
  | "unknown"
  | "not_applicable";

export interface LoanCollateralValuation {
  loanId: string;
  collateralMarketValue: number;
  trackedCollateralValue: number;
  manualCollateralValue: number;
  missingPositionCount: number;
  maintenanceRatioPercent: number | null;
  warningBufferPercent: number | null;
  callBufferPercent: number | null;
  creditUtilizationPercent: number | null;
  availableCredit: number | null;
  daysToMaturity: number | null;
  riskLevel: LoanRiskLevel;
  usesManualCollateralValue: boolean;
}

export interface PortfolioLoanRiskSummary {
  monitoredLoanCount: number;
  criticalCount: number;
  warningCount: number;
  unknownCount: number;
  lowestMaintenanceRatioPercent: number | null;
  nextMaturityDate: string | null;
  totalCollateralMarketValue: number;
}
