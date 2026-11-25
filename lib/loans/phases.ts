import type { Loan } from "@/lib/types/loan";

function closesBeforeSuccessor(loan: Loan, successor: Loan) {
  return loan.status !== "active" && !!loan.closedAt &&
    loan.closedAt >= loan.trackingStartDate && loan.closedAt < successor.trackingStartDate;
}

export function loanPhaseConflicts(loans: Loan[]): { loan: Loan; successor?: Loan }[] {
  const byId = new Map(loans.map((loan) => [loan.id, loan]));
  const conflicts: { loan: Loan; successor?: Loan }[] = [];
  for (const loan of loans) {
    if (loan.status !== "active" && loan.closedAt && loan.closedAt < loan.trackingStartDate) conflicts.push({ loan });
    const parent = byId.get(loan.restartedFromLoanId ?? "");
    if (parent && !closesBeforeSuccessor(parent, loan)) conflicts.push({ loan: parent, successor: loan });
  }
  return conflicts;
}

export function repairLoanPhaseClosures(loans: Loan[], recordedClosures: Loan[]): Loan[] {
  const successors = new Map<string, Loan>();
  for (const loan of loans) {
    if (!loan.restartedFromLoanId) continue;
    const other = successors.get(loan.restartedFromLoanId);
    if (!other || loan.trackingStartDate < other.trackingStartDate) successors.set(loan.restartedFromLoanId, loan);
  }
  const closures = new Map<string, { closedAt: string; status: Loan["status"]; updatedAt: string }[]>();
  for (const loan of recordedClosures) {
    if (loan.status === "active" || !loan.closedAt) continue;
    const known = closures.get(loan.id) ?? [];
    known.push({ closedAt: loan.closedAt, status: loan.status, updatedAt: loan.statusUpdatedAt ?? loan.updatedAt });
    closures.set(loan.id, known);
  }
  // 只用曾保存的清償版本，日期無法核對時留待使用者更正。
  return loans.map((loan) => {
    const successor = successors.get(loan.id);
    if (!successor || closesBeforeSuccessor(loan, successor)) return loan;
    const prior = (closures.get(loan.id) ?? [])
      .filter((item) => item.closedAt < successor.trackingStartDate && item.closedAt >= loan.trackingStartDate)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.closedAt.localeCompare(b.closedAt))[0];
    return prior ? { ...loan, status: prior.status, closedAt: prior.closedAt, statusUpdatedAt: prior.updatedAt } : loan;
  });
}

export function conflictingLoanPhaseIds(loans: Loan[]): Set<string> {
  const ids = new Set<string>();
  for (const { loan, successor } of loanPhaseConflicts(loans)) {
    ids.add(loan.id);
    if (successor) ids.add(successor.id);
  }
  return ids;
}

export function loansWithConsistentPhases(loans: Loan[]): Loan[] {
  const conflicting = conflictingLoanPhaseIds(loans);
  return conflicting.size ? loans.filter((loan) => !conflicting.has(loan.id)) : loans;
}
