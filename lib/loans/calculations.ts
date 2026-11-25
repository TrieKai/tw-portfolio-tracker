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
import { isDateInLoanTracking, loanPaymentsInTracking } from "@/lib/loans/history";

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
  const scheduled = schedule
    .filter((row) => row.principal > 0)
    .map((row) => ({ date: row.paymentDate, principal: row.remainingPrincipal, priority: 0 }));
  const recorded = (loan.balanceHistory ?? []).map((snapshot) => ({
    date: snapshot.effectiveDate, principal: snapshot.balance, priority: 1,
  }));
  // 同日的本金快照代表實際期末餘額，優先於攤還預估。
  return [...scheduled, ...recorded].sort(
    (a, b) => a.date.localeCompare(b.date) || a.priority - b.priority
  );
}

function annuityPayment(principal: number, monthlyRate: number, periods: number) {
  if (periods <= 0) return principal;
  if (monthlyRate === 0) return principal / periods;
  const factor = Math.pow(1 + monthlyRate, periods);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function orderedRateChanges(loan: Loan) {
  return [...(loan.rateHistory ?? [])].sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );
}

export function interestRateAtDate(loan: Loan, asOfDate: string): number {
  const date = effectiveEndDate(loan, asOfDate);
  let rate = loan.annualInterestRate;
  for (const change of orderedRateChanges(loan)) {
    if (change.effectiveDate > date) break;
    rate = change.annualInterestRate;
  }
  return Math.max(0, rate);
}

function installmentCredits(loan: Loan) {
  const credits = new Map<string, { principal: number; interest: number; beforeDuePrincipal: number; postedLate: boolean }>();
  for (const payment of loanPaymentsInTracking(loan)) {
    const dueDate = payment.installmentDueDate;
    if (!dueDate || payment.principalPaid + payment.interestPaid <= 0) continue;
    const credit = credits.get(dueDate) ?? { principal: 0, interest: 0, beforeDuePrincipal: 0, postedLate: false };
    credit.principal += payment.principalPaid;
    credit.interest += payment.interestPaid;
    if (payment.paymentDate < dueDate) credit.beforeDuePrincipal += payment.principalPaid;
    if (payment.paymentDate > dueDate) credit.postedLate = true;
    credits.set(dueDate, credit);
  }
  return credits;
}

/**
 * 採月利率預估還款，每期按天數分配生效前後的本金與利率。
 */
export function buildLoanSchedule(loan: Loan): LoanScheduleRow[] {
  const periods = loan.remainingTermMonths;
  if (
    !periods ||
    periods <= 0 ||
    (loan.openingBalance <= 0 && !loan.balanceHistory?.some((snapshot) => snapshot.balance > 0)) ||
    loan.repaymentMethod === "revolving"
  ) {
    return [];
  }

  const gracePeriods = Math.min(
    Math.max(0, loan.gracePeriodMonths ?? 0),
    Math.max(0, periods - 1)
  );
  const amortizationPeriods = Math.max(1, periods - gracePeriods);
  let fixedPrincipal = loan.openingBalance / amortizationPeriods;
  let monthlyRate = Math.max(0, loan.annualInterestRate) / 1_200;
  let paymentRate = monthlyRate;
  let fixedPayment = annuityPayment(
    loan.openingBalance,
    monthlyRate,
    amortizationPeriods
  );
  const terms = [
    ...orderedRateChanges(loan).map((change) => ({ date: change.effectiveDate, rate: change.annualInterestRate })),
    ...(loan.balanceHistory ?? []).map((snapshot) => ({ date: snapshot.effectiveDate, balance: snapshot.balance })),
  ].filter((event) => event.date >= loan.trackingStartDate).sort((a, b) => a.date.localeCompare(b.date));
  const firstPaymentDate = resolveFirstPaymentDate(loan);
  const preferredDay = Number(firstPaymentDate.slice(8, 10));
  const rows: LoanScheduleRow[] = [];
  const credits = installmentCredits(loan);
  let balance = loan.openingBalance;
  let periodStart = loan.trackingStartDate;
  let nextEvent = 0;
  let deferredInterest = 0;

  for (let installment = 1; installment <= periods; installment += 1) {
    const paymentDate = addMonthsClamped(firstPaymentDate, installment - 1, preferredDay);
    if (loan.closedAt && paymentDate > loan.closedAt) break;
    const periodDays = Math.max(1, daysBetween(periodStart, paymentDate));
    let cursor = periodStart;
    let weightedInterest = 0;
    while (nextEvent < terms.length && terms[nextEvent].date < paymentDate) {
      const event = terms[nextEvent++];
      weightedInterest += balance * monthlyRate * daysBetween(cursor, event.date);
      if ("rate" in event) monthlyRate = Math.max(0, event.rate) / 1_200;
      else balance = event.balance;
      cursor = event.date;
    }
    weightedInterest += balance * monthlyRate * daysBetween(cursor, paymentDate);
    const openingPrincipal = balance;
    const inGrace = installment <= gracePeriods;
    let interest = weightedInterest / periodDays;
    let principal = 0;

    if (loan.repaymentMethod === "bullet") {
      deferredInterest += interest;
      interest = installment === periods ? deferredInterest : 0;
    } else if (!inGrace) {
      const remainingPeriods = periods - installment + 1;
      if (loan.repaymentMethod === "equal_payment") {
        if (monthlyRate !== paymentRate || fixedPayment === 0) {
          fixedPayment = annuityPayment(openingPrincipal, monthlyRate, remainingPeriods);
          paymentRate = monthlyRate;
        }
        principal = Math.max(0, fixedPayment - interest);
      } else if (loan.repaymentMethod === "equal_principal") {
        if (fixedPrincipal === 0) fixedPrincipal = openingPrincipal / remainingPeriods;
        principal = fixedPrincipal;
      }
    }

    const credit = credits.get(paymentDate);
    const beforeCredit = openingPrincipal + (credit?.beforeDuePrincipal ?? 0);
    if (installment === periods || principal > beforeCredit) {
      principal = beforeCredit;
    }
    const creditedAmount = credit ? credit.principal + credit.interest : undefined;
    if (credit && creditedAmount !== undefined) {
      const remainingPrincipal = Math.max(0, principal - credit.principal);
      // 本金已在實付日更新，應繳日只推估尚未沖抵的數額。
      // 最後一期仍須預估清償全部未償本金，不把多付的利息視為本金。
      const remainingPayment = installment === periods
        ? remainingPrincipal + Math.max(0, interest - credit.interest)
        : Math.max(0, roundMoney(principal + interest - creditedAmount));
      principal = Math.min(openingPrincipal, remainingPrincipal, remainingPayment);
      interest = Math.max(0, remainingPayment - remainingPrincipal);
    }
    // 已知這期有逾期入帳時，未結清部分仍留在本金，直到有實際快照。
    balance = credit?.postedLate ? openingPrincipal : Math.max(0, openingPrincipal - principal);
    periodStart = paymentDate;

    rows.push({
      installment,
      paymentDate,
      openingPrincipal: roundMoney(openingPrincipal),
      principal: roundMoney(principal),
      interest: roundMoney(interest),
      payment: roundMoney(principal + interest),
      remainingPrincipal: roundMoney(balance),
      ...(creditedAmount === undefined ? {} : { creditedAmount: roundMoney(creditedAmount) }),
    });
  }

  return rows;
}

export function loanInstallmentOptions(loan: Loan): LoanScheduleRow[] {
  if (isFlexiblePrincipalLoan(loan)) return [];
  return buildLoanSchedule(loan).filter((row) => loan.repaymentMethod !== "bullet" || row.installment === loan.remainingTermMonths);
}

function effectiveEndDate(loan: Loan, asOfDate: string): string {
  if (loan.status !== "active" && loan.closedAt && loan.closedAt < asOfDate) return loan.closedAt;
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
  const startDate = fromDate > loan.trackingStartDate
    ? fromDate
    : loan.trackingStartDate;
  let cursor = startDate;
  let principal = principalAtDate(loan, startDate, schedule);
  let annualInterestRate = interestRateAtDate(loan, startDate);
  let interest = 0;

  const events = [
    ...buildPrincipalEvents(loan, schedule).map((event) => ({
      ...event,
      kind: "principal" as const,
    })),
    ...orderedRateChanges(loan).map((change) => ({
      date: change.effectiveDate,
      kind: "rate" as const,
      rate: change.annualInterestRate,
      priority: 2,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);

  for (const event of events) {
    // 起算日已讀取最新本金與利率。之後同一天的事件都須套用，事件之間不再計息。
    if (event.date <= startDate) continue;
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

interface StatementPeriod {
  startDate: string;
  endDate: string;
}

function estimateInterestForStatementPeriods(
  loan: Loan,
  periods: StatementPeriod[],
  schedule: LoanScheduleRow[]
): number {
  const [first, ...rest] = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!first) return 0;
  let { startDate, endDate } = first;
  let interest = 0;
  for (const period of rest) {
    if (period.startDate <= endDate) {
      if (period.endDate > endDate) endDate = period.endDate;
      continue;
    }
    interest += estimateLoanInterestForPeriod(loan, startDate, endDate, schedule);
    ({ startDate, endDate } = period);
  }
  return interest + estimateLoanInterestForPeriod(loan, startDate, endDate, schedule);
}

export function estimateLoanFinancingCostForPeriod(
  loan: Loan,
  fromDate: string,
  toDate: string,
  schedule: LoanScheduleRow[] = buildLoanSchedule(loan)
): number {
  if (toDate <= fromDate) return 0;
  const interest = estimateLoanInterestForPeriod(loan, fromDate, toDate, schedule);
  const includesInitialFee =
    loan.trackingStartDate > fromDate && loan.trackingStartDate <= toDate;
  const priorStatements: StatementPeriod[] = [];
  const currentStatements: StatementPeriod[] = [];
  let payments = 0;
  for (const payment of loanPaymentsInTracking(loan)) {
    if (payment.paymentDate > toDate) continue;
    const belongsToPeriod = payment.paymentDate > fromDate;
    if (belongsToPeriod) payments += payment.feePaid - payment.subsidyReceived;
    const { interestPeriodStartDate: startDate, interestPeriodEndDate: endDate } = payment;
    if (!startDate || !endDate || startDate >= endDate) continue;
    if (belongsToPeriod) {
      payments += payment.interestPaid;
      currentStatements.push({ startDate, endDate });
    } else {
      priorStatements.push({ startDate, endDate });
    }
  }
  // 同一計息日的估算值只沖銷一次，各次實付仍歸屬到各自的繳款日。
  const replacedEstimate = currentStatements.length
    ? estimateInterestForStatementPeriods(loan, [...priorStatements, ...currentStatements], schedule) -
      estimateInterestForStatementPeriods(loan, priorStatements, schedule)
    : 0;
  return roundMoney(
    interest +
      (includesInitialFee ? loan.initialFees ?? 0 : 0) +
      payments - replacedEstimate
  );
}

/** 固定利率分期貸款的費用後年化報酬率；浮動或循環額度因未來現金流未知不估算。 */
export function calculateLoanEffectiveApr(loan: Loan): number | null {
  if (
    loan.rateType !== "fixed" ||
    isFlexiblePrincipalLoan(loan) ||
    loan.rateHistory?.some((change) => isDateInLoanTracking(loan, change.effectiveDate))
  ) {
    return null;
  }
  const schedule = buildLoanSchedule({
    ...loan, balanceHistory: undefined, paymentHistory: undefined, rateHistory: undefined, closedAt: undefined,
  });
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
  toDate: string,
  schedules?: ReadonlyMap<Loan, LoanScheduleRow[]>
): number {
  return roundMoney(
    loans.reduce((sum, loan) => {
      if (loan.investmentUsePercent <= 0) return sum;
      const share = Math.min(100, loan.investmentUsePercent) / 100;
      return sum + estimateLoanFinancingCostForPeriod(loan, fromDate, toDate, schedules?.get(loan)) * share;
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
    asOfDate,
    schedule
  );
  const canForecast = loan.status === "active" && !isFlexiblePrincipalLoan(loan) && schedule.length > 0;
  const remainingRows = canForecast ? schedule.filter((row) => row.paymentDate > asOfDate) : [];
  const nextPayment = remainingRows.find((row) => row.payment > 0) ?? null;

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
      canForecast
        ? roundMoney(remainingRows.reduce((sum, row) => sum + row.interest, 0))
        : null,
    projectedTotalPayment:
      canForecast
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
  const schedules = new Map(loans.filter((loan) => loan.investmentUsePercent > 0)
    .map((loan) => [loan, buildLoanSchedule(loan)]));
  let date = fromDate;
  while (date <= toDate) {
    const previous = addDaysToIsoDate(date, -1);
    const cost = estimateInvestmentFinancingCostForPeriod(loans, previous, date, schedules);
    if (Math.abs(cost) > 1e-9) result[date] = cost;
    date = addDaysToIsoDate(date, 1);
  }
  return result;
}
