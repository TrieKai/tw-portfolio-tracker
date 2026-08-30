import type { PortfolioStorage } from "@/lib/types/holding";
import type {
  CreateLoanInput,
  EditLoanInput,
  Loan,
  LoanStatus,
} from "@/lib/types/loan";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeLoanInput(input: CreateLoanInput): CreateLoanInput {
  const investmentUsePercent = Math.min(
    100,
    Math.max(0, input.investmentUsePercent)
  );
  return {
    ...input,
    name: input.name.trim(),
    ...(input.lender?.trim() ? { lender: input.lender.trim() } : { lender: undefined }),
    investmentUsePercent,
    openingBalance: Math.max(0, input.openingBalance),
    annualInterestRate: Math.max(0, input.annualInterestRate),
    ...(input.initialFees !== undefined
      ? { initialFees: Math.max(0, input.initialFees) }
      : {}),
    ...(input.accountLastFour?.trim()
      ? { accountLastFour: input.accountLastFour.trim().slice(-4) }
      : { accountLastFour: undefined }),
  };
}

export function addLoan(
  state: PortfolioStorage,
  input: CreateLoanInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const normalized = normalizeLoanInput(input);
  const loan: Loan = {
    ...normalized,
    id: newId("loan"),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, loans: [...state.loans, loan] };
}

/** 編輯代表更正契約資料，因此保留被取代的完整版本。 */
export function editLoan(
  state: PortfolioStorage,
  input: EditLoanInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const previous = state.loans.find((loan) => loan.id === input.id);
  if (!previous) return state;
  const normalized = normalizeLoanInput(input);
  const next: Loan = {
    ...previous,
    ...normalized,
    id: previous.id,
    status: previous.status,
    closedAt: previous.closedAt,
    createdAt: previous.createdAt,
    updatedAt: now,
  };
  return {
    ...state,
    loans: state.loans.map((loan) => (loan.id === input.id ? next : loan)),
    loanRevisions: [
      ...state.loanRevisions,
      {
        id: newId("loan-revision"),
        loanId: previous.id,
        previous,
        correctedAt: now,
      },
    ],
  };
}

export function setLoanStatus(
  state: PortfolioStorage,
  loanId: string,
  status: LoanStatus,
  effectiveDate: string,
  now = new Date().toISOString()
): PortfolioStorage {
  if (!state.loans.some((loan) => loan.id === loanId)) return state;
  return {
    ...state,
    loans: state.loans.map((loan) =>
      loan.id === loanId
        ? {
            ...loan,
            status,
            closedAt: status === "active" ? undefined : effectiveDate,
            updatedAt: now,
          }
        : loan
    ),
  };
}
