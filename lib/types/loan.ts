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
