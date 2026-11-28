import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import type { Loan, LoanPaymentRecord, LoanRevision } from "@/lib/types/loan";

/** 清償日當日起退出未償本金、還款預估與風險監控。 */
export function isLoanOpenAt(loan: Loan, date: string): boolean {
  return date >= loan.trackingStartDate && (loan.closedAt ? date < loan.closedAt : loan.status === "active");
}

/** 已結束但缺少清償日的舊資料，無法推算持續計息的期間。 */
export function loanEstimateEndDate(loan: Loan, date: string): string {
  if (loan.closedAt) return loan.closedAt < date ? loan.closedAt : date;
  return loan.status === "active" ? date : loan.trackingStartDate;
}

export function isDateInLoanTracking(loan: Loan, date: string): boolean {
  return !!parseIsoDate(date) && date >= loan.trackingStartDate &&
    (loan.status === "active" || (!!loan.closedAt && date <= loan.closedAt));
}

export function loanActualEntryEndDate(loan: Loan, today = todayIsoDate()): string {
  return loan.closedAt && loan.closedAt < today ? loan.closedAt : today;
}

export function isRecordedLoanPaymentInTracking(loan: Loan, date: string): boolean {
  // 舊貸款缺少清償日時，仍可使用已有日期的實付單據。
  return !!parseIsoDate(date) && date >= loan.trackingStartDate && (!loan.closedAt || date <= loan.closedAt);
}

export function loanPaymentsInTracking(loan: Loan) {
  return (loan.paymentHistory ?? []).filter((payment) => isRecordedLoanPaymentInTracking(loan, payment.paymentDate));
}

export function loanPaymentInterestPeriod(loan: Loan, payment: LoanPaymentRecord) {
  const { interestPeriodStartDate: startDate, interestPeriodEndDate: endDate } = payment;
  if (startDate && endDate && startDate >= loan.trackingStartDate && startDate < endDate && endDate <= payment.paymentDate) {
    return { startDate, endDate };
  }
}

export function loanTrackingStartIssue(date: string, predecessor?: Loan, closedAt?: string): string | undefined {
  if (!parseIsoDate(date)) return "請輸入有效的本金基準日。";
  if (predecessor && (predecessor.status === "active" || !predecessor.closedAt)) return "請先確認上一段貸款的清償日。";
  if (predecessor?.closedAt && date <= predecessor.closedAt) return `本金基準日須晚於上一段的清償日 ${predecessor.closedAt}。`;
  if (closedAt && date > closedAt) return `本金基準日須在清償日 ${closedAt} 當日或之前。`;
}

export function resolveLoanVersions(loan: Loan, revisions: LoanRevision[]) {
  if (loan.statusUpdatedAt && loan.contractUpdatedAt) {
    return { statusUpdatedAt: loan.statusUpdatedAt, contractUpdatedAt: loan.contractUpdatedAt };
  }
  const history = [...revisions].sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
  const statusChanges = history.filter((revision, index) => {
    const after = history[index + 1]?.previous ?? loan;
    return after.status !== revision.previous.status || after.closedAt !== revision.previous.closedAt;
  });
  const statusDates = new Set(statusChanges.map((revision) => revision.correctedAt));
  const events = [
    ...(loan.balanceHistory ?? []).map((entry) => entry.recordedAt),
    ...(loan.rateHistory ?? []).map((entry) => entry.createdAt),
    ...(loan.paymentHistory ?? []).flatMap((entry) => [entry.createdAt, entry.installmentAssignedAt]),
  ];
  // 舊版清償也會更新契約時間。由修訂紀錄找回清償前的契約版本。
  let contractUpdatedAt = loan.contractUpdatedAt;
  for (const revision of [...statusChanges].reverse()) {
    if (contractUpdatedAt === revision.correctedAt) contractUpdatedAt = revision.previous.contractUpdatedAt;
  }
  const latestContractEvent = history.filter((revision) => !statusDates.has(revision.correctedAt)).at(-1)?.correctedAt;
  const lastUpdate = events.includes(loan.updatedAt) || statusDates.has(loan.updatedAt) ? loan.createdAt : loan.updatedAt;
  return {
    contractUpdatedAt: contractUpdatedAt ?? (latestContractEvent && latestContractEvent > lastUpdate ? latestContractEvent : lastUpdate),
    statusUpdatedAt: loan.statusUpdatedAt ?? statusChanges.at(-1)?.correctedAt ??
      (loan.closedAt ? `${loan.closedAt}T00:00:00.000Z` : loan.createdAt),
  };
}

/** 實付可更正原有的攤還預估。本金上限只看付款日前已知或當日已登錄的快照。 */
export function recordedPrincipalOn(loan: Loan, date: string): number {
  let balance = loan.openingBalance;
  let latest = loan.trackingStartDate;
  for (const snapshot of loan.balanceHistory ?? []) {
    if (snapshot.effectiveDate >= latest && snapshot.effectiveDate <= date) {
      latest = snapshot.effectiveDate;
      balance = snapshot.balance;
    }
  }
  return balance;
}

export function earliestLoanClosureDate(loan: Loan, today = todayIsoDate()): string {
  const activity = [
    ...(loan.paymentHistory ?? []).map((payment) => payment.paymentDate),
    ...(loan.balanceHistory ?? []).map((snapshot) => snapshot.effectiveDate),
  ];
  return activity.reduce((latest, date) => date <= today && date > latest ? date : latest, loan.trackingStartDate);
}
