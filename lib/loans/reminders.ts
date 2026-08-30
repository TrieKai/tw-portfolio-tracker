import { parseIsoDate } from "@/lib/date/iso-date";
import { calculateLoanSnapshot } from "@/lib/loans/calculations";
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

  for (const loan of loans) {
    if (!isOpenAt(loan, asOfDate)) continue;
    const snapshot = calculateLoanSnapshot(loan, asOfDate);
    const recordedPaymentDates = new Set(
      (loan.paymentHistory ?? []).map((payment) => payment.paymentDate)
    );
    const upcomingPayment = snapshot.schedule.find(
      (row) =>
        row.paymentDate >= asOfDate &&
        !recordedPaymentDates.has(row.paymentDate)
    );
    if (upcomingPayment) {
      const days = daysBetween(asOfDate, upcomingPayment.paymentDate);
      if (days !== null && days >= 0 && days <= 7) {
        reminders.push({
          id: `${loan.id}:payment_due:${upcomingPayment.paymentDate}`,
          loanId: loan.id,
          loanName: loan.name,
          kind: "payment_due",
          severity: days <= 1 ? "warning" : "info",
          date: upcomingPayment.paymentDate,
          message:
            days === 0
              ? `今天預計繳款 ${Math.round(upcomingPayment.payment).toLocaleString("zh-TW")} 元`
              : `${days} 天後預計繳款 ${Math.round(upcomingPayment.payment).toLocaleString("zh-TW")} 元`,
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

    const unreconciledCount = (loan.paymentHistory ?? []).filter(
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
