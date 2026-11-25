import { parseIsoDate } from "@/lib/date/iso-date";
import { buildLoanSchedule } from "@/lib/loans/calculations";
import { loanPaymentsInTracking } from "@/lib/loans/history";
import { loansWithConsistentPhases } from "@/lib/loans/phases";
import {
  calculateLoanCollateralValuation,
  hasCollateralRisk,
  hasFlexibleCredit,
} from "@/lib/loans/risk";
import type { Holding } from "@/lib/types/holding";
import type { Loan, LoanReminder } from "@/lib/types/loan";

const MS_PER_DAY = 86_400_000;

function daysBetween(fromDate: string, toDate: string): number | null {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return null;
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function isOpenAt(loan: Loan, asOfDate: string): boolean {
  return (
    loan.trackingStartDate <= asOfDate &&
    (!loan.closedAt || loan.closedAt > asOfDate)
  );
}

export function buildLoanReminders(
  loans: Loan[],
  holdings: Holding[],
  asOfDate: string
): LoanReminder[] {
  const reminders: LoanReminder[] = [];

  for (const loan of loansWithConsistentPhases(loans)) {
    if (!isOpenAt(loan, asOfDate)) continue;
    const recordedByDate = new Map<string, number>();
    const payments = loanPaymentsInTracking(loan);
    for (const payment of payments) {
      if (payment.installmentDueDate) continue;
      const paid = recordedByDate.get(payment.paymentDate) ?? 0;
      recordedByDate.set(payment.paymentDate, paid + payment.principalPaid + payment.interestPaid);
    }
    const schedule = hasFlexibleCredit(loan) ? [] : buildLoanSchedule(loan);
    const unpaidAmount = (row: (typeof schedule)[number]) =>
      row.payment - (recordedByDate.get(row.paymentDate) ?? 0);
    // 舊的未核對排程仍作估算。已有明確期別入帳的部分繳款，才追蹤逾期待補差額。
    const overdue = schedule.find((row) => row.paymentDate < asOfDate &&
      (row.creditedAmount ?? 0) > 0 && Math.round(unpaidAmount(row)) > 0);
    const upcomingPayment = overdue ?? schedule.find((row) => row.paymentDate >= asOfDate &&
      Math.round(unpaidAmount(row)) > 0);
    if (upcomingPayment) {
      const days = daysBetween(asOfDate, upcomingPayment.paymentDate);
      if (days !== null && days <= 7) {
        const recorded = (recordedByDate.get(upcomingPayment.paymentDate) ?? 0) + (upcomingPayment.creditedAmount ?? 0);
        const dateLabel = days === 0 ? "今天" : `${days} 天後`;
        reminders.push({
          id: `${loan.id}:payment_due:${upcomingPayment.paymentDate}`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "payment_due",
          severity: days <= 1 ? "warning" : "info",
          date: upcomingPayment.paymentDate,
          amount: unpaidAmount(upcomingPayment),
          message: days < 0 ? `${upcomingPayment.paymentDate} 期已過應繳日，預估尚需繳款`
            : `${dateLabel}${recorded > 0 ? "預計尚需繳款" : "預計繳款"}`,
        });
      }
    }

    if (loan.maturityDate) {
      const days = daysBetween(asOfDate, loan.maturityDate);
      if (days !== null && days <= 30) {
        reminders.push({
          id: `${loan.id}:maturity_due:${loan.maturityDate}`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "maturity_due",
          severity: days < 0 ? "critical" : "warning",
          date: loan.maturityDate,
          message:
            days < 0
              ? `契約已逾期 ${Math.abs(days)} 天`
              : days === 0
                ? "契約今天到期"
                : `契約將於 ${days} 天後到期`,
        });
      }
    }

    if (hasFlexibleCredit(loan)) {
      const valuation = calculateLoanCollateralValuation(
        loan,
        holdings,
        asOfDate
      );
      const collateralCritical =
        hasCollateralRisk(loan) &&
        valuation.maintenanceRatioPercent !== null &&
        loan.maintenanceCallPercent !== undefined &&
        valuation.maintenanceRatioPercent <= loan.maintenanceCallPercent;
      const collateralWarning =
        hasCollateralRisk(loan) &&
        valuation.maintenanceRatioPercent !== null &&
        loan.maintenanceWarningPercent !== undefined &&
        valuation.maintenanceRatioPercent <= loan.maintenanceWarningPercent;
      if (collateralCritical) {
        reminders.push({
          id: `${loan.id}:critical_risk`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "critical_risk",
          severity: "critical",
          message: "維持率已達追繳門檻",
        });
      } else if (collateralWarning) {
        reminders.push({
          id: `${loan.id}:risk_warning`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "risk_warning",
          severity: "warning",
          message: "維持率接近警示門檻",
        });
      } else if (
        hasCollateralRisk(loan) &&
        valuation.riskLevel === "unknown"
      ) {
        reminders.push({
          id: `${loan.id}:risk_data_missing`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "risk_data_missing",
          severity: "info",
          message: "缺少擔保品現價或契約門檻，無法判斷維持率",
        });
      }
    }

    const unreconciledCount = payments.filter(
      (payment) =>
        payment.interestPaid > 0 &&
        (!payment.interestPeriodStartDate || !payment.interestPeriodEndDate)
    ).length;
    if (unreconciledCount > 0) {
      reminders.push({
        id: `${loan.id}:unreconciled_interest`,
        loanId: loan.id,
        loanName: loan.name,
        kind: "unreconciled_interest",
        severity: "info",
        message: `${unreconciledCount} 筆實付利息尚未指定計息期間，損益仍採估算`,
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  return reminders.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") ||
      a.loanName.localeCompare(b.loanName, "zh-TW")
  );
}
