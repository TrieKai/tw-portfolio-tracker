import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import type { Loan } from "@/lib/types/loan";

export function isDateInLoanTracking(loan: Loan, date: string): boolean {
  return !!parseIsoDate(date) && date >= loan.trackingStartDate &&
    (loan.status === "active" || (!!loan.closedAt && date <= loan.closedAt));
}

export function loanActualEntryEndDate(loan: Loan, today = todayIsoDate()): string {
  return loan.closedAt && loan.closedAt < today ? loan.closedAt : today;
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
