import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { loanInstallmentOptions } from "@/lib/loans/calculations";
import { collateralShareFactor, restoreCollateralShareBases } from "@/lib/loans/collateral";
import { earliestLoanClosureDate, isDateInLoanTracking, loanActualEntryEndDate, loanTrackingStartIssue, recordedPrincipalOn, resolveLoanVersions } from "@/lib/loans/history";
import type { PortfolioStorage } from "@/lib/types/holding";
import type {
  CreateLoanPaymentInput,
  CreateLoanRateChangeInput,
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

function normalizeLoanInput(state: PortfolioStorage, input: CreateLoanInput, previous?: Loan): CreateLoanInput {
  const investmentUsePercent = Math.min(
    100,
    Math.max(0, input.investmentUsePercent)
  );
  const previousPositions = previous?.collateralPositions?.some((position) => position.shareBasisFactor === undefined)
    ? restoreCollateralShareBases(state).loans.find((loan) => loan.id === previous.id)?.collateralPositions
    : previous?.collateralPositions;
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
    ...(input.creditLimit !== undefined
      ? { creditLimit: Math.max(0, input.creditLimit) }
      : {}),
    ...(input.maintenanceWarningPercent !== undefined
      ? {
          maintenanceWarningPercent: Math.max(
            0,
            input.maintenanceWarningPercent
          ),
        }
      : {}),
    ...(input.maintenanceCallPercent !== undefined
      ? { maintenanceCallPercent: Math.max(0, input.maintenanceCallPercent) }
      : {}),
    ...(input.collateralPositions
      ? {
          collateralPositions: input.collateralPositions
            .filter(
              (position) =>
                position.holdingId &&
                Number.isFinite(position.quantity) &&
                position.quantity > 0
            )
            .map((position) => {
              if (position.shareBasisFactor !== undefined && Number.isFinite(position.shareBasisFactor) && position.shareBasisFactor > 0) {
                return { ...position };
              }
              const unchanged = previousPositions?.find((old) => old.holdingId === position.holdingId && old.quantity === position.quantity);
              if (unchanged) return { ...unchanged };
              const holding = state.holdings.find((item) => item.id === position.holdingId && item.assetType === "stock");
              const factor = holding ? collateralShareFactor(holding, state.corporateActions, todayIsoDate()) : undefined;
              return { holdingId: position.holdingId, quantity: position.quantity,
                ...(factor !== undefined && Number.isFinite(factor) && factor > 0 ? { shareBasisFactor: factor } : {}),
              };
            }),
        }
      : {}),
    ...(input.manualCollateralValue !== undefined
      ? { manualCollateralValue: Math.max(0, input.manualCollateralValue) }
      : {}),
  };
}

export function addLoan(
  state: PortfolioStorage,
  input: CreateLoanInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const normalized = normalizeLoanInput(state, input);
  const loan: Loan = {
    ...normalized,
    id: newId("loan"),
    status: "active",
    statusUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    contractUpdatedAt: now,
  };
  return { ...state, loans: [...state.loans, loan] };
}

/** 從新的起算日另建追蹤紀錄，清償期間的本金與利息維持原狀。 */
export function restartLoan(
  state: PortfolioStorage,
  loanId: string,
  input: CreateLoanInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const previous = state.loans.find((loan) => loan.id === loanId);
  if (
    !previous || loanTrackingStartIssue(input.trackingStartDate, previous) ||
    state.loans.some((loan) => loan.restartedFromLoanId === loanId)
  ) return state;
  const next = addLoan(state, {
    ...input,
    balanceHistory: undefined,
    paymentHistory: undefined,
    paymentImportReviews: undefined,
    rateHistory: undefined,
  }, now);
  return {
    ...next,
    loans: [...state.loans, { ...next.loans.at(-1)!, restartedFromLoanId: loanId }],
  };
}

/** 編輯代表更正契約資料，因此保留被取代的完整版本。 */
export function editLoan(
  state: PortfolioStorage,
  input: EditLoanInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const previous = state.loans.find((loan) => loan.id === input.id);
  if (!previous) return state;
  const predecessor = state.loans.find((loan) => loan.id === previous.restartedFromLoanId);
  if (loanTrackingStartIssue(input.trackingStartDate, predecessor, previous.closedAt)) return state;
  const normalized = normalizeLoanInput(state, input, previous);
  const { statusUpdatedAt } = resolveLoanVersions(previous, state.loanRevisions.filter((revision) => revision.loanId === previous.id));
  const next: Loan = {
    ...previous,
    ...normalized,
    id: previous.id,
    status: previous.status,
    closedAt: previous.closedAt,
    statusUpdatedAt,
    restartedFromLoanId: previous.restartedFromLoanId,
    createdAt: previous.createdAt,
    updatedAt: now,
    contractUpdatedAt: now,
    balanceHistory: previous.balanceHistory,
    paymentHistory: previous.paymentHistory,
    rateHistory: previous.rateHistory,
    paymentImportReviews: previous.paymentImportReviews,
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
  const previous = state.loans.find((loan) => loan.id === loanId);
  if (!previous || previous.status === status) return state;
  if (status === "active" && state.loans.some((loan) => loan.restartedFromLoanId === loanId)) return state;
  const today = todayIsoDate();
  if (status !== "active" && (!parseIsoDate(effectiveDate) || effectiveDate > today ||
      effectiveDate < earliestLoanClosureDate(previous, today) ||
      state.loans.some((loan) => loan.restartedFromLoanId === loanId && loan.trackingStartDate <= effectiveDate))) return state;
  const versions = resolveLoanVersions(previous, state.loanRevisions.filter((revision) => revision.loanId === loanId));
  const previousVersion = Date.parse(versions.statusUpdatedAt);
  const statusUpdatedAt = Number.isFinite(previousVersion) && Date.parse(now) <= previousVersion
    ? new Date(previousVersion + 1).toISOString() : now;
  return {
    ...state,
    loanRevisions: [
      ...state.loanRevisions,
      { id: newId("loan-revision"), loanId, previous, correctedAt: now },
    ],
    loans: state.loans.map((loan) =>
      loan.id === loanId
        ? {
            ...loan,
            status,
            closedAt: status === "active" ? undefined : effectiveDate,
            statusUpdatedAt,
            updatedAt: now,
            contractUpdatedAt: versions.contractUpdatedAt,
          }
        : loan
    ),
  };
}

/** 記錄某日起適用的本金，不改寫先前期間的利息計算基準。 */
export function recordLoanBalance(
  state: PortfolioStorage,
  loanId: string,
  balance: number,
  effectiveDate: string,
  now = new Date().toISOString()
): PortfolioStorage {
  if (!Number.isFinite(balance) || balance < 0) return state;
  const loan = state.loans.find((item) => item.id === loanId);
  if (!loan || !isDateInLoanTracking(loan, effectiveDate) || effectiveDate > loanActualEntryEndDate(loan)) return state;

  const byDate = new Map(
    (loan.balanceHistory ?? []).map((snapshot) => [
      snapshot.effectiveDate,
      snapshot,
    ])
  );
  byDate.set(effectiveDate, { effectiveDate, balance, recordedAt: now });
  const balanceHistory = [...byDate.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );

  return {
    ...state,
    loans: state.loans.map((item) =>
      item.id === loanId
        ? { ...item, balanceHistory, updatedAt: now }
        : item
    ),
  };
}

export function recordLoanPayment(
  state: PortfolioStorage,
  loanId: string,
  input: CreateLoanPaymentInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const loan = state.loans.find((item) => item.id === loanId);
  if (!loan || !isDateInLoanTracking(loan, input.paymentDate) ||
      input.paymentDate > loanActualEntryEndDate(loan)) return state;
  if (input.installmentDueDate && !loanInstallmentOptions(loan)
    .some((row) => row.paymentDate === input.installmentDueDate)) return state;
  const amounts = [
    input.principalPaid,
    input.interestPaid,
    input.feePaid,
    input.subsidyReceived,
  ];
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
    return state;
  }
  if (
    input.remainingPrincipalAfter !== undefined &&
    (!Number.isFinite(input.remainingPrincipalAfter) ||
      input.remainingPrincipalAfter < 0 ||
      input.remainingPrincipalAfter > recordedPrincipalOn(loan, input.paymentDate))
  ) {
    return state;
  }
  if (input.principalPaid > 0 && input.remainingPrincipalAfter === undefined) {
    return state;
  }
  if (input.remainingPrincipalAfter === undefined && amounts.every((amount) => amount === 0)) return state;
  const hasInterestPeriod =
    !!input.interestPeriodStartDate && !!input.interestPeriodEndDate;
  if (
    (!!input.interestPeriodStartDate !== !!input.interestPeriodEndDate) ||
    (hasInterestPeriod &&
      (!parseIsoDate(input.interestPeriodStartDate!) || !parseIsoDate(input.interestPeriodEndDate!) ||
        input.interestPeriodStartDate! >= input.interestPeriodEndDate! ||
        input.interestPeriodStartDate! < loan.trackingStartDate ||
        input.interestPeriodEndDate! > input.paymentDate))
  ) {
    return state;
  }

  const payment = {
    ...input,
    id: newId("loan-payment"),
    note: input.note?.trim() || undefined,
    createdAt: now,
  };
  let next: PortfolioStorage = {
    ...state,
    loans: state.loans.map((item) =>
      item.id === loanId
        ? {
            ...item,
            paymentHistory: [...(item.paymentHistory ?? []), payment].sort(
              (a, b) =>
                a.paymentDate.localeCompare(b.paymentDate) ||
                a.createdAt.localeCompare(b.createdAt)
            ),
            updatedAt: now,
          }
        : item
    ),
  };
  if (input.remainingPrincipalAfter !== undefined) {
    next = recordLoanBalance(
      next,
      loanId,
      input.remainingPrincipalAfter,
      input.paymentDate,
      now
    );
  }
  return next;
}

export function assignLoanPaymentInstallment(
  state: PortfolioStorage,
  loanId: string,
  paymentId: string,
  dueDate?: string,
  now = new Date().toISOString()
): PortfolioStorage {
  const loan = state.loans.find((item) => item.id === loanId);
  const payment = loan?.paymentHistory?.find((entry) => entry.id === paymentId);
  if (!loan || !payment || !isDateInLoanTracking(loan, payment.paymentDate) || payment.installmentDueDate === dueDate) return state;
  if (dueDate && !loanInstallmentOptions(loan).some((row) => row.paymentDate === dueDate)) return state;
  const updated: Loan = {
    ...loan,
    updatedAt: now,
    paymentHistory: loan.paymentHistory!.map((entry) => entry.id === paymentId ? {
      ...entry, installmentDueDate: dueDate, installmentAssignedAt: now,
    } : entry),
  };
  return { ...state, loans: state.loans.map((item) => item.id === loanId ? updated : item) };
}

export function recordLoanRateChange(
  state: PortfolioStorage,
  loanId: string,
  input: CreateLoanRateChangeInput,
  now = new Date().toISOString()
): PortfolioStorage {
  const loan = state.loans.find((item) => item.id === loanId);
  if (
    !loan ||
    !isDateInLoanTracking(loan, input.effectiveDate) ||
    !Number.isFinite(input.annualInterestRate) ||
    input.annualInterestRate < 0 ||
    input.annualInterestRate > 100
  ) {
    return state;
  }
  const change = {
    ...input,
    id: newId("loan-rate"),
    note: input.note?.trim() || undefined,
    createdAt: now,
  };
  return {
    ...state,
    loans: state.loans.map((item) =>
      item.id === loanId
        ? {
            ...item,
            rateHistory: [...(item.rateHistory ?? []), change].sort(
              (a, b) =>
                a.effectiveDate.localeCompare(b.effectiveDate) ||
                a.createdAt.localeCompare(b.createdAt)
            ),
            updatedAt: now,
          }
        : item
    ),
  };
}
