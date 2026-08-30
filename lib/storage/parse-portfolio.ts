import { normalizeToIsoDate } from "@/lib/date/iso-date";
import type {
  Holding,
  PortfolioSettings,
  PortfolioStorage,
  PriceHistoryMap,
  PricePoint,
} from "@/lib/types/holding";
import {
  LOAN_TYPES,
  type Loan,
  type LoanBalanceSnapshot,
  type LoanCollateralPosition,
  type LoanPaymentRecord,
  type LoanRateChange,
  type LoanPurpose,
  type LoanRateType,
  type LoanRepaymentMethod,
  type LoanStatus,
} from "@/lib/types/loan";
import { normalizeUiPreferences } from "@/lib/ui/preferences";
import { migratePortfolioStorage } from "@/lib/storage/portfolio-migration";

const DEFAULT_SETTINGS: PortfolioSettings = {
  autoUpdateEnabled: false,
  theme: "system",
};

export function defaultPortfolioStorage(): PortfolioStorage {
  return {
    version: 2,
    holdings: [],
    loans: [],
    loanRevisions: [],
    priceHistory: {},
    sales: [],
    corporateActions: [],
    transactions: [],
    transactionRevisions: [],
    pnlTracking: { startedAt: "", dailySummaries: {} },
    settings: { ...DEFAULT_SETTINGS },
  };
}

const LOAN_PURPOSES: LoanPurpose[] = [
  "investment",
  "property",
  "personal",
  "mixed",
];
const LOAN_RATE_TYPES: LoanRateType[] = ["fixed", "floating"];
const LOAN_REPAYMENT_METHODS: LoanRepaymentMethod[] = [
  "equal_payment",
  "equal_principal",
  "interest_only",
  "bullet",
  "revolving",
];
const LOAN_STATUSES: LoanStatus[] = ["active", "paid_off", "refinanced"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeCollateralPositions(
  value: unknown
): LoanCollateralPosition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const positions = value.flatMap((position) => {
    if (
      !isRecord(position) ||
      typeof position.holdingId !== "string" ||
      !position.holdingId ||
      typeof position.quantity !== "number" ||
      !Number.isFinite(position.quantity) ||
      position.quantity <= 0
    ) {
      return [];
    }
    return [{ holdingId: position.holdingId, quantity: position.quantity }];
  });
  return positions.length > 0 ? positions : undefined;
}

function normalizeBalanceHistory(
  value: unknown,
  trackingStartDate: string,
  fallbackRecordedAt: string
): LoanBalanceSnapshot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byDate = new Map<string, LoanBalanceSnapshot>();
  for (const snapshot of value) {
    if (
      !isRecord(snapshot) ||
      typeof snapshot.effectiveDate !== "string" ||
      typeof snapshot.balance !== "number" ||
      !Number.isFinite(snapshot.balance) ||
      snapshot.balance < 0
    ) {
      continue;
    }
    const effectiveDate = normalizeToIsoDate(snapshot.effectiveDate);
    if (!effectiveDate || effectiveDate < trackingStartDate) continue;
    byDate.set(effectiveDate, {
      effectiveDate,
      balance: snapshot.balance,
      recordedAt:
        typeof snapshot.recordedAt === "string"
          ? snapshot.recordedAt
          : fallbackRecordedAt,
    });
  }
  const history = [...byDate.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate)
  );
  return history.length > 0 ? history : undefined;
}

function normalizePaymentHistory(
  value: unknown,
  trackingStartDate: string,
  fallbackCreatedAt: string
): LoanPaymentRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const payments: LoanPaymentRecord[] = [];
  for (const payment of value) {
    if (!isRecord(payment) || typeof payment.id !== "string") continue;
    const paymentDate =
      typeof payment.paymentDate === "string"
        ? normalizeToIsoDate(payment.paymentDate)
        : null;
    const amounts = [
      payment.principalPaid,
      payment.interestPaid,
      payment.feePaid,
      payment.subsidyReceived,
    ];
    if (
      !paymentDate ||
      paymentDate < trackingStartDate ||
      amounts.some(
        (amount) =>
          typeof amount !== "number" ||
          !Number.isFinite(amount) ||
          amount < 0
      )
    ) {
      continue;
    }
    const periodStart =
      typeof payment.interestPeriodStartDate === "string"
        ? normalizeToIsoDate(payment.interestPeriodStartDate)
        : null;
    const periodEnd =
      typeof payment.interestPeriodEndDate === "string"
        ? normalizeToIsoDate(payment.interestPeriodEndDate)
        : null;
    const hasValidPeriod =
      !!periodStart &&
      !!periodEnd &&
      periodStart >= trackingStartDate &&
      periodStart < periodEnd &&
      periodEnd <= paymentDate;
    payments.push({
      id: payment.id,
      paymentDate,
      principalPaid: payment.principalPaid as number,
      interestPaid: payment.interestPaid as number,
      feePaid: payment.feePaid as number,
      subsidyReceived: payment.subsidyReceived as number,
      ...(typeof payment.remainingPrincipalAfter === "number" &&
      Number.isFinite(payment.remainingPrincipalAfter) &&
      payment.remainingPrincipalAfter >= 0
        ? { remainingPrincipalAfter: payment.remainingPrincipalAfter }
        : {}),
      ...(hasValidPeriod
        ? {
            interestPeriodStartDate: periodStart,
            interestPeriodEndDate: periodEnd,
          }
        : {}),
      ...(typeof payment.note === "string" && payment.note.trim()
        ? { note: payment.note.trim() }
        : {}),
      createdAt:
        typeof payment.createdAt === "string"
          ? payment.createdAt
          : fallbackCreatedAt,
    });
  }
  payments.sort(
    (a, b) =>
      a.paymentDate.localeCompare(b.paymentDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );
  return payments.length > 0 ? payments : undefined;
}

function normalizeRateHistory(
  value: unknown,
  trackingStartDate: string,
  fallbackCreatedAt: string
): LoanRateChange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const changes: LoanRateChange[] = [];
  for (const change of value) {
    if (
      !isRecord(change) ||
      typeof change.id !== "string" ||
      typeof change.effectiveDate !== "string" ||
      typeof change.annualInterestRate !== "number" ||
      !Number.isFinite(change.annualInterestRate) ||
      change.annualInterestRate < 0 ||
      change.annualInterestRate > 100
    ) {
      continue;
    }
    const effectiveDate = normalizeToIsoDate(change.effectiveDate);
    if (!effectiveDate || effectiveDate < trackingStartDate) continue;
    changes.push({
      id: change.id,
      effectiveDate,
      annualInterestRate: change.annualInterestRate,
      ...(typeof change.note === "string" && change.note.trim()
        ? { note: change.note.trim() }
        : {}),
      createdAt:
        typeof change.createdAt === "string"
          ? change.createdAt
          : fallbackCreatedAt,
    });
  }
  changes.sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );
  return changes.length > 0 ? changes : undefined;
}

function normalizeLoan(raw: unknown): Loan | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    !isOneOf(LOAN_TYPES, raw.loanType) ||
    !isOneOf(LOAN_PURPOSES, raw.purpose) ||
    typeof raw.openingBalance !== "number" ||
    !Number.isFinite(raw.openingBalance) ||
    raw.openingBalance < 0 ||
    typeof raw.trackingStartDate !== "string" ||
    !normalizeToIsoDate(raw.trackingStartDate) ||
    typeof raw.annualInterestRate !== "number" ||
    !Number.isFinite(raw.annualInterestRate) ||
    raw.annualInterestRate < 0 ||
    !isOneOf(LOAN_RATE_TYPES, raw.rateType) ||
    !isOneOf(LOAN_REPAYMENT_METHODS, raw.repaymentMethod)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const investmentUsePercent =
    typeof raw.investmentUsePercent === "number" &&
    Number.isFinite(raw.investmentUsePercent)
      ? Math.min(100, Math.max(0, raw.investmentUsePercent))
      : raw.purpose === "investment"
        ? 100
        : 0;
  const status = isOneOf(LOAN_STATUSES, raw.status) ? raw.status : "active";
  const dataQuality =
    raw.dataQuality === "complete" ||
    raw.dataQuality === "estimated" ||
    raw.dataQuality === "incomplete"
      ? raw.dataQuality
      : "estimated";
  const collateralPositions = normalizeCollateralPositions(
    raw.collateralPositions
  );
  const trackingStartDate = normalizeToIsoDate(raw.trackingStartDate)!;
  const balanceHistory = normalizeBalanceHistory(
    raw.balanceHistory,
    trackingStartDate,
    now
  );
  const paymentHistory = normalizePaymentHistory(
    raw.paymentHistory,
    trackingStartDate,
    now
  );
  const rateHistory = normalizeRateHistory(
    raw.rateHistory,
    trackingStartDate,
    now
  );

  return {
    id: raw.id,
    name: raw.name.trim() || "未命名貸款",
    ...(typeof raw.lender === "string" && raw.lender.trim()
      ? { lender: raw.lender.trim() }
      : {}),
    loanType: raw.loanType,
    purpose: raw.purpose,
    investmentUsePercent,
    ...(typeof raw.linkedHoldingId === "string" && raw.linkedHoldingId
      ? { linkedHoldingId: raw.linkedHoldingId }
      : {}),
    openingBalance: raw.openingBalance,
    trackingStartDate,
    ...(optionalPositiveNumber(raw.remainingTermMonths)
      ? { remainingTermMonths: Math.round(raw.remainingTermMonths as number) }
      : {}),
    ...(typeof raw.firstPaymentDate === "string" &&
    normalizeToIsoDate(raw.firstPaymentDate)
      ? { firstPaymentDate: normalizeToIsoDate(raw.firstPaymentDate) }
      : {}),
    annualInterestRate: raw.annualInterestRate,
    rateType: raw.rateType,
    repaymentMethod: raw.repaymentMethod,
    ...(typeof raw.gracePeriodMonths === "number" &&
    Number.isFinite(raw.gracePeriodMonths) &&
    raw.gracePeriodMonths >= 0
      ? { gracePeriodMonths: Math.round(raw.gracePeriodMonths) }
      : {}),
    ...(optionalPositiveNumber(raw.originalPrincipal)
      ? { originalPrincipal: raw.originalPrincipal as number }
      : {}),
    ...(typeof raw.contractStartDate === "string" &&
    normalizeToIsoDate(raw.contractStartDate)
      ? { contractStartDate: normalizeToIsoDate(raw.contractStartDate) }
      : {}),
    ...(optionalPositiveNumber(raw.originalTermMonths)
      ? { originalTermMonths: Math.round(raw.originalTermMonths as number) }
      : {}),
    ...(typeof raw.initialFees === "number" &&
    Number.isFinite(raw.initialFees) &&
    raw.initialFees >= 0
      ? { initialFees: raw.initialFees }
      : {}),
    ...(typeof raw.accountLastFour === "string" && /^\d{4}$/.test(raw.accountLastFour)
      ? { accountLastFour: raw.accountLastFour }
      : {}),
    ...(optionalPositiveNumber(raw.creditLimit)
      ? { creditLimit: raw.creditLimit as number }
      : {}),
    ...(typeof raw.maturityDate === "string" &&
    normalizeToIsoDate(raw.maturityDate)
      ? { maturityDate: normalizeToIsoDate(raw.maturityDate) }
      : {}),
    ...(optionalPositiveNumber(raw.maintenanceWarningPercent)
      ? { maintenanceWarningPercent: raw.maintenanceWarningPercent as number }
      : {}),
    ...(optionalPositiveNumber(raw.maintenanceCallPercent)
      ? { maintenanceCallPercent: raw.maintenanceCallPercent as number }
      : {}),
    ...(collateralPositions ? { collateralPositions } : {}),
    ...(typeof raw.manualCollateralValue === "number" &&
    Number.isFinite(raw.manualCollateralValue) &&
    raw.manualCollateralValue >= 0
      ? { manualCollateralValue: raw.manualCollateralValue }
      : {}),
    ...(balanceHistory ? { balanceHistory } : {}),
    ...(paymentHistory ? { paymentHistory } : {}),
    ...(rateHistory ? { rateHistory } : {}),
    status,
    ...(typeof raw.closedAt === "string" && normalizeToIsoDate(raw.closedAt)
      ? { closedAt: normalizeToIsoDate(raw.closedAt) }
      : {}),
    dataQuality,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

function migratedLoanBase(migratedAt: string) {
  return {
    annualInterestRate: 0,
    rateType: "floating" as const,
    repaymentMethod: "equal_payment" as const,
    status: "active" as const,
    dataQuality: "incomplete" as const,
    trackingStartDate: migratedAt.slice(0, 10),
    createdAt: migratedAt,
    updatedAt: migratedAt,
  };
}

function migrateLegacyLoans(
  holdings: Holding[],
  settings: PortfolioSettings,
  migratedAt: string
): Loan[] {
  const base = migratedLoanBase(migratedAt);
  const loans: Loan[] = [];
  const liabilities = settings.liabilities ?? 0;
  if (liabilities > 0) {
    loans.push({
      ...base,
      id: "legacy-investment-liabilities",
      name: "既有投資負債",
      loanType: "other",
      purpose: "investment",
      investmentUsePercent: 100,
      openingBalance: liabilities,
    });
  }
  for (const holding of holdings) {
    const mortgageBalance = holding.mortgageBalance ?? 0;
    if (holding.assetType !== "property" || mortgageBalance <= 0) continue;
    loans.push({
      ...base,
      id: `legacy-mortgage-${holding.id}`,
      name: `${holding.name} 房貸`,
      loanType: "mortgage",
      purpose: "property",
      investmentUsePercent: 0,
      linkedHoldingId: holding.id,
      openingBalance: mortgageBalance,
    });
  }
  return loans;
}

function normalizeHoldingDates(holding: Holding): Holding {
  const buyDate = normalizeToIsoDate(holding.buyDate) ?? holding.buyDate;
  const priceDate = holding.priceDate
    ? normalizeToIsoDate(holding.priceDate) ?? holding.priceDate
    : holding.priceDate;
  if (buyDate === holding.buyDate && priceDate === holding.priceDate) {
    return holding;
  }
  return { ...holding, buyDate, priceDate };
}

/** 修正歷史價格中的 YYYYMMDD／斜線日期，避免時間軸與比較失效 */
function normalizePriceHistoryMap(priceHistory: PriceHistoryMap): PriceHistoryMap {
  const next: PriceHistoryMap = {};
  for (const [holdingId, points] of Object.entries(priceHistory ?? {})) {
    if (!Array.isArray(points)) continue;
    const normalizedPoints: PricePoint[] = [];
    const byDate = new Map<string, PricePoint>();
    for (const point of points) {
      if (!point || typeof point.date !== "string") continue;
      const date = normalizeToIsoDate(point.date);
      if (!date) continue;
      byDate.set(date, { ...point, date });
    }
    normalizedPoints.push(...byDate.values());
    normalizedPoints.sort((a, b) => a.date.localeCompare(b.date));
    next[holdingId] = normalizedPoints;
  }
  return next;
}

/** 驗證並正規化未知 JSON 為 PortfolioStorage */
export function normalizePortfolioStorage(
  raw: unknown,
  options?: { migratedAt?: string }
): PortfolioStorage | null {
  if (!raw || typeof raw !== "object") return null;
  const version = (raw as { version?: unknown }).version;
  let migrated: unknown = raw;
  if (version === 1) {
    try {
      migrated = migratePortfolioStorage(raw, {
      migratedAt: options?.migratedAt ?? new Date().toISOString(),
      });
    } catch {
      return null;
    }
  }
  const parsed = migrated as PortfolioStorage;
  if (parsed.version !== 2 || !Array.isArray(parsed.holdings)) return null;

  const rawSettings =
    parsed.settings && typeof parsed.settings === "object"
      ? parsed.settings
      : DEFAULT_SETTINGS;

  const normalizedHoldings = parsed.holdings.map(normalizeHoldingDates);
  const hasLoanCollection = Object.prototype.hasOwnProperty.call(
    migrated,
    "loans"
  );
  const migratedAt = options?.migratedAt ?? new Date().toISOString();
  const loans = hasLoanCollection
    ? (Array.isArray(parsed.loans) ? parsed.loans : [])
        .map(normalizeLoan)
        .filter((loan): loan is Loan => loan !== null)
    : migrateLegacyLoans(normalizedHoldings, rawSettings, migratedAt);
  const holdings = hasLoanCollection
    ? normalizedHoldings
    : normalizedHoldings.map(({ mortgageBalance: _legacyMortgage, ...holding }) =>
        holding
      );

  return {
    ...defaultPortfolioStorage(),
    ...parsed,
    holdings,
    loans,
    loanRevisions: Array.isArray(parsed.loanRevisions)
      ? parsed.loanRevisions
      : [],
    priceHistory: normalizePriceHistoryMap(
      parsed.priceHistory && typeof parsed.priceHistory === "object"
        ? parsed.priceHistory
        : {}
    ),
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    corporateActions: Array.isArray(parsed.corporateActions)
      ? parsed.corporateActions
      : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    transactionRevisions: Array.isArray(parsed.transactionRevisions)
      ? parsed.transactionRevisions
      : [],
    pnlTracking:
      parsed.pnlTracking && typeof parsed.pnlTracking === "object"
        ? {
            startedAt:
              typeof parsed.pnlTracking.startedAt === "string"
                ? parsed.pnlTracking.startedAt
                : "",
            dailySummaries:
              parsed.pnlTracking.dailySummaries &&
              typeof parsed.pnlTracking.dailySummaries === "object"
                ? parsed.pnlTracking.dailySummaries
                : {},
          }
        : { startedAt: "", dailySummaries: {} },
    settings: {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      liabilities: undefined,
      ...(rawSettings.uiPreferences
        ? { uiPreferences: normalizeUiPreferences(rawSettings.uiPreferences) }
        : {}),
    },
  };
}

export function hasPortfolioData(state: PortfolioStorage): boolean {
  return (
    state.holdings.length > 0 ||
    state.loans.length > 0 ||
    state.sales.length > 0 ||
    state.corporateActions.length > 0
  );
}
