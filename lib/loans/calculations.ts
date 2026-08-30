import {
  addDaysToIsoDate,
  parseIsoDate,
  startOfMonthIsoFromPrefix,
  toIsoDate,
} from "@/lib/date/iso-date";
import type {
  Loan,
  LoanScheduleRow,
  LoanSnapshot,
  PortfolioLoanSummary,
} from "@/lib/types/loan";

const MS_PER_DAY = 86_400_000;

function isFlexiblePrincipalLoan(loan: Loan): boolean {
  return (
    loan.loanType === "securities_margin" ||
    loan.loanType === "securities_pledge" ||
    loan.loanType === "revolving_credit"
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function daysBetween(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end || end <= start) return 0;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function addMonthsClamped(
  iso: string,
  months: number,
  preferredDay?: number
): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const day = preferredDay ?? date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return toIsoDate(target);
}

function resolveFirstPaymentDate(loan: Loan): string {
  const preferred = loan.firstPaymentDate;
  if (preferred && preferred > loan.trackingStartDate) return preferred;
  return addMonthsClamped(
    loan.trackingStartDate,
    1,
    preferred ? Number(preferred.slice(8, 10)) : undefined
  );
}

function buildPrincipalEvents(
  loan: Loan,
  schedule: LoanScheduleRow[]
): Array<{ date: string; principal: number; priority: number }> {
  const scheduleChanges = schedule
    .filter((row) => row.principal > 0)
    .map((row) => ({ date: row.paymentDate, row, priority: 0 as const }));
  const snapshots = (loan.balanceHistory ?? []).map((snapshot) => ({
    date: snapshot.effectiveDate,
    snapshot,
    priority: 1 as const,
  }));
  const sources = [...scheduleChanges, ...snapshots].sort(
    (a, b) => a.date.localeCompare(b.date) || a.priority - b.priority
  );
  let scheduleOffset = 0;
  const events: Array<{ date: string; principal: number; priority: number }> = [];

  for (const source of sources) {
    if ("row" in source) {
      events.push({
        date: source.date,
        principal:
          source.row.remainingPrincipal === 0
            ? 0
            : Math.max(0, source.row.remainingPrincipal + scheduleOffset),
        priority: source.priority,
      });
      continue;
    }

    let scheduledPrincipal = loan.openingBalance;
    for (const row of scheduleChanges) {
      if (row.date > source.date) break;
      scheduledPrincipal = row.row.remainingPrincipal;
    }
    scheduleOffset = source.snapshot.balance - scheduledPrincipal;
    events.push({
      date: source.date,
      principal: source.snapshot.balance,
      priority: source.priority,
    });
  }
  return events;
}

function annuityPayment(principal: number, monthlyRate: number, periods: number) {
  if (periods <= 0) return principal;
  if (monthlyRate === 0) return principal / periods;
  const factor = Math.pow(1 + monthlyRate, periods);
  return (principal * monthlyRate * factor) / (factor - 1);
}

export function interestRateAtDate(loan: Loan, asOfDate: string): number {
  let rate = loan.annualInterestRate;
  const changes = [...(loan.rateHistory ?? [])].sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );
  for (const change of changes) {
    if (change.effectiveDate > asOfDate) break;
    rate = change.annualInterestRate;
  }
  return Math.max(0, rate);
}

/**
 * 以 trackingStartDate 的本金快照建立還款預估。呼叫端不需要理解各種
 * 攤還法的尾差、寬限期或零利率處理。
 */
export function buildLoanSchedule(loan: Loan): LoanScheduleRow[] {
  const periods = loan.remainingTermMonths;
  if (
    !periods ||
    periods <= 0 ||
    loan.openingBalance <= 0 ||
    loan.repaymentMethod === "revolving"
  ) {
    return [];
  }

  const monthlyRate = Math.max(0, loan.annualInterestRate) / 1_200;
  const gracePeriods = Math.min(
    Math.max(0, loan.gracePeriodMonths ?? 0),
    Math.max(0, periods - 1)
  );
  const amortizationPeriods = Math.max(1, periods - gracePeriods);
  const fixedPayment = annuityPayment(
    loan.openingBalance,
    monthlyRate,
    amortizationPeriods
  );
  const fixedPrincipal = loan.openingBalance / amortizationPeriods;
  const firstPaymentDate = resolveFirstPaymentDate(loan);
  const preferredDay = Number(firstPaymentDate.slice(8, 10));
  const rows: LoanScheduleRow[] = [];
  let balance = loan.openingBalance;

  for (let installment = 1; installment <= periods; installment += 1) {
    const openingPrincipal = balance;
    const inGrace = installment <= gracePeriods;
    let interest = openingPrincipal * monthlyRate;
    let principal = 0;

    if (loan.repaymentMethod === "bullet") {
      principal = installment === periods ? openingPrincipal : 0;
      interest = installment === periods
        ? openingPrincipal * monthlyRate * periods
        : 0;
    } else if (!inGrace) {
      if (loan.repaymentMethod === "equal_payment") {
        principal = fixedPayment - interest;
      } else if (loan.repaymentMethod === "equal_principal") {
        principal = fixedPrincipal;
      } else if (loan.repaymentMethod === "interest_only") {
        principal = installment === periods ? openingPrincipal : 0;
      }
    }

    if (installment === periods || principal > openingPrincipal) {
      principal = openingPrincipal;
    }
    balance = Math.max(0, openingPrincipal - principal);
    const paymentDate = addMonthsClamped(
      firstPaymentDate,
      installment - 1,
      preferredDay
    );

    rows.push({
      installment,
      paymentDate,
      openingPrincipal: roundMoney(openingPrincipal),
      principal: roundMoney(principal),
      interest: roundMoney(interest),
      payment: roundMoney(principal + interest),
      remainingPrincipal: roundMoney(balance),
    });
  }

  return rows;
}

function effectiveEndDate(loan: Loan, asOfDate: string): string {
  if (loan.closedAt && loan.closedAt < asOfDate) return loan.closedAt;
  return asOfDate;
}

export function principalAtDate(
  loan: Loan,
  asOfDate: string,
  schedule: LoanScheduleRow[] = buildLoanSchedule(loan)
): number {
  if (asOfDate < loan.trackingStartDate) return 0;
  if (loan.status !== "active" && loan.closedAt && asOfDate >= loan.closedAt) {
    return 0;
  }
  let principal = loan.openingBalance;
  const events = buildPrincipalEvents(loan, schedule);
  for (const event of events) {
    if (event.date > asOfDate) break;
    principal = event.principal;
  }
  return roundMoney(principal);
}

/** 實際天數／365 日累積；排程只用來決定每次還本後的本金。 */
export function estimateLoanInterestForPeriod(
  loan: Loan,
  fromDate: string,
  toDate: string,
  schedule: LoanScheduleRow[] = buildLoanSchedule(loan)
): number {
  if (
    toDate <= fromDate ||
    toDate <= loan.trackingStartDate
  ) {
    return 0;
  }

  const endDate = effectiveEndDate(loan, toDate);
  if (endDate <= fromDate) return 0;
  let cursor = fromDate > loan.trackingStartDate
    ? fromDate
    : loan.trackingStartDate;
  let principal = principalAtDate(loan, cursor, schedule);
  let annualInterestRate = interestRateAtDate(loan, cursor);
  let interest = 0;

  const events = [
    ...buildPrincipalEvents(loan, schedule).map((event) => ({
      ...event,
      kind: "principal" as const,
    })),
    ...(loan.rateHistory ?? []).map((change) => ({
      date: change.effectiveDate,
      kind: "rate" as const,
      rate: change.annualInterestRate,
      priority: 2,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);

  for (const event of events) {
    if (event.date <= cursor) continue;
    if (event.date > endDate) break;
    const days = daysBetween(cursor, event.date);
    interest += principal * (annualInterestRate / 100) * (days / 365);
    if (event.kind === "principal") principal = event.principal;
    else annualInterestRate = Math.max(0, event.rate);
    cursor = event.date;
  }

  if (cursor < endDate && principal > 0) {
    const days = daysBetween(cursor, endDate);
    interest += principal * (annualInterestRate / 100) * (days / 365);
  }
  return roundMoney(interest);
}

export function estimateLoanFinancingCostForPeriod(
  loan: Loan,
  fromDate: string,
  toDate: string
): number {
  const interest = estimateLoanInterestForPeriod(loan, fromDate, toDate);
  const includesInitialFee =
    loan.trackingStartDate > fromDate && loan.trackingStartDate <= toDate;
  let reconciliationAdjustment = 0;
  for (const payment of loan.paymentHistory ?? []) {
    if (payment.paymentDate <= fromDate || payment.paymentDate > toDate) {
      continue;
    }
    reconciliationAdjustment += payment.feePaid - payment.subsidyReceived;
    if (
      payment.interestPeriodStartDate &&
      payment.interestPeriodEndDate
    ) {
      const estimatedForStatement = estimateLoanInterestForPeriod(
        loan,
        payment.interestPeriodStartDate,
        payment.interestPeriodEndDate
      );
      reconciliationAdjustment +=
        payment.interestPaid - estimatedForStatement;
    }
  }
  return roundMoney(
    interest +
      (includesInitialFee ? loan.initialFees ?? 0 : 0) +
      reconciliationAdjustment
  );
}

/** 固定利率分期貸款的費用後年化報酬率；浮動或循環額度因未來現金流未知不估算。 */
export function calculateLoanEffectiveApr(loan: Loan): number | null {
  if (
    loan.rateType !== "fixed" ||
    isFlexiblePrincipalLoan(loan) ||
    (loan.rateHistory?.length ?? 0) > 0
  ) {
    return null;
  }
  const schedule = buildLoanSchedule(loan);
  const netProceeds = loan.openingBalance - (loan.initialFees ?? 0);
  if (schedule.length === 0 || netProceeds <= 0) return null;
  const payments = schedule.map((row) => row.payment);
  const npv = (monthlyRate: number) =>
    netProceeds -
    payments.reduce(
      (sum, payment, index) =>
        sum + payment / Math.pow(1 + monthlyRate, index + 1),
      0
    );
  if (Math.abs(npv(0)) < 1e-8) return 0;
  if (npv(0) > 0) return null;

  let low = 0;
  let high = 1;
  while (npv(high) < 0 && high < 128) high *= 2;
  if (npv(high) < 0) return null;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (npv(middle) > 0) high = middle;
    else low = middle;
  }
  const monthlyRate = (low + high) / 2;
  return roundMoney((Math.pow(1 + monthlyRate, 12) - 1) * 100);
}

export function estimateInvestmentFinancingCostForPeriod(
  loans: Loan[],
  fromDate: string,
  toDate: string
): number {
  return roundMoney(
    loans.reduce((sum, loan) => {
      if (loan.investmentUsePercent <= 0) return sum;
      const share = Math.min(100, loan.investmentUsePercent) / 100;
      return sum + estimateLoanFinancingCostForPeriod(loan, fromDate, toDate) * share;
    }, 0)
  );
}

export function calculateLoanSnapshot(
  loan: Loan,
  asOfDate: string
): LoanSnapshot {
  const schedule = buildLoanSchedule(loan);
  const currentPrincipal = principalAtDate(loan, asOfDate, schedule);
  const estimatedInterestToDate = estimateLoanInterestForPeriod(
    loan,
    addDaysToIsoDate(loan.trackingStartDate, -1),
    asOfDate,
    schedule
  );
  const estimatedFinancingCostToDate = estimateLoanFinancingCostForPeriod(
    loan,
    addDaysToIsoDate(loan.trackingStartDate, -1),
    asOfDate
  );
  const flexiblePrincipal = isFlexiblePrincipalLoan(loan);
  const nextPayment =
    loan.status === "active" && !flexiblePrincipal
      ? schedule.find((row) => row.paymentDate > asOfDate) ?? null
      : null;
  const remainingRows = schedule.filter((row) => row.paymentDate > asOfDate);

  return {
    loan,
    currentPrincipal,
    currentAnnualInterestRate: interestRateAtDate(loan, asOfDate),
    effectiveAprPercent: calculateLoanEffectiveApr(loan),
    schedule,
    nextPayment,
    estimatedInterestToDate,
    estimatedFinancingCostToDate,
    projectedInterest:
      schedule.length > 0 && !flexiblePrincipal
        ? roundMoney(remainingRows.reduce((sum, row) => sum + row.interest, 0))
        : null,
    projectedTotalPayment:
      schedule.length > 0 && !flexiblePrincipal
        ? roundMoney(remainingRows.reduce((sum, row) => sum + row.payment, 0))
        : null,
  };
}

export function calculatePortfolioLoanSummary(
  loans: Loan[],
  options: { asOfDate: string; grossInvestmentPnl?: number }
): PortfolioLoanSummary {
  const { asOfDate, grossInvestmentPnl = 0 } = options;
  const snapshots = loans.map((loan) => calculateLoanSnapshot(loan, asOfDate));
  let totalDebt = 0;
  let investmentDebt = 0;
  let propertyDebt = 0;
  let estimatedInterestToDate = 0;
  let investmentFinancingCostToDate = 0;

  for (const snapshot of snapshots) {
    const { loan, currentPrincipal } = snapshot;
    totalDebt += currentPrincipal;
    const investmentShare = Math.min(100, Math.max(0, loan.investmentUsePercent)) / 100;
    investmentDebt += currentPrincipal * investmentShare;
    if (loan.purpose === "property") propertyDebt += currentPrincipal;
    estimatedInterestToDate += snapshot.estimatedInterestToDate;
    investmentFinancingCostToDate +=
      snapshot.estimatedFinancingCostToDate * investmentShare;
  }

  const monthStart = startOfMonthIsoFromPrefix(asOfDate.slice(0, 7));
  const monthlyInvestmentFinancingCost = estimateInvestmentFinancingCostForPeriod(
    loans,
    addDaysToIsoDate(monthStart, -1),
    asOfDate
  );
  const nextDate = snapshots
    .map((snapshot) => snapshot.nextPayment?.paymentDate)
    .filter((date): date is string => !!date)
    .sort()[0] ?? null;
  const nextPaymentAmount = nextDate
    ? snapshots.reduce(
        (sum, snapshot) =>
          sum +
          (snapshot.nextPayment?.paymentDate === nextDate
            ? snapshot.nextPayment.payment
            : 0),
        0
      )
    : 0;

  return {
    activeLoanCount: loans.filter(
      (loan) =>
        loan.trackingStartDate <= asOfDate &&
        (!loan.closedAt || loan.closedAt > asOfDate)
    ).length,
    totalDebt: roundMoney(totalDebt),
    investmentDebt: roundMoney(investmentDebt),
    propertyDebt: roundMoney(propertyDebt),
    personalDebt: roundMoney(Math.max(0, totalDebt - investmentDebt - propertyDebt)),
    estimatedInterestToDate: roundMoney(estimatedInterestToDate),
    investmentFinancingCostToDate: roundMoney(investmentFinancingCostToDate),
    monthlyInvestmentFinancingCost,
    nextPaymentDate: nextDate,
    nextPaymentAmount: roundMoney(nextPaymentAmount),
    grossInvestmentPnl: roundMoney(grossInvestmentPnl),
    netInvestmentPnl: roundMoney(
      grossInvestmentPnl - investmentFinancingCostToDate
    ),
    hasIncompleteData: loans.some((loan) => loan.dataQuality !== "complete"),
  };
}

/** 提供損益日曆使用；key 為日期，值為投資用途的當日估算融資成本。 */
export function buildDailyInvestmentFinancingCosts(
  loans: Loan[],
  fromDate: string,
  toDate: string
): Record<string, number> {
  const result: Record<string, number> = {};
  let date = fromDate;
  while (date <= toDate) {
    const previous = addDaysToIsoDate(date, -1);
    const cost = estimateInvestmentFinancingCostForPeriod(loans, previous, date);
    if (Math.abs(cost) > 1e-9) result[date] = cost;
    date = addDaysToIsoDate(date, 1);
  }
  return result;
}
