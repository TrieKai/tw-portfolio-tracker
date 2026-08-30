import { describe, expect, it } from "vitest";
import {
  buildLoanSchedule,
  calculateLoanSnapshot,
  calculatePortfolioLoanSummary,
  estimateInvestmentFinancingCostForPeriod,
} from "@/lib/loans/calculations";
import type { Loan } from "@/lib/types/loan";

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    name: "測試信貸",
    loanType: "personal_credit",
    purpose: "investment",
    investmentUsePercent: 100,
    openingBalance: 120_000,
    trackingStartDate: "2026-01-01",
    remainingTermMonths: 12,
    firstPaymentDate: "2026-02-01",
    annualInterestRate: 6,
    rateType: "fixed",
    repaymentMethod: "equal_payment",
    status: "active",
    dataQuality: "complete",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loan calculations", () => {
  it("builds an equal-payment schedule that clears the principal", () => {
    const schedule = buildLoanSchedule(loan());

    expect(schedule).toHaveLength(12);
    expect(schedule[0].payment).toBeCloseTo(schedule[10].payment, 4);
    expect(schedule.at(-1)?.remainingPrincipal).toBe(0);
    expect(schedule[0].principal).toBeGreaterThan(0);
  });

  it("reduces equal-principal interest over time", () => {
    const schedule = buildLoanSchedule(
      loan({ repaymentMethod: "equal_principal" })
    );

    expect(schedule[0].principal).toBeCloseTo(10_000, 4);
    expect(schedule[0].interest).toBeGreaterThan(schedule[10].interest);
    expect(schedule.at(-1)?.remainingPrincipal).toBe(0);
  });

  it("keeps principal outstanding until the final interest-only payment", () => {
    const schedule = buildLoanSchedule(
      loan({ repaymentMethod: "interest_only" })
    );

    expect(schedule[0].principal).toBe(0);
    expect(schedule[0].remainingPrincipal).toBe(120_000);
    expect(schedule.at(-1)?.principal).toBe(120_000);
  });

  it("does not double-count grace-period interest for a bullet loan", () => {
    const schedule = buildLoanSchedule(
      loan({ repaymentMethod: "bullet", gracePeriodMonths: 3 })
    );

    expect(schedule.slice(0, -1).every((row) => row.payment === 0)).toBe(true);
    expect(schedule.at(-1)?.principal).toBe(120_000);
    expect(schedule.at(-1)?.interest).toBeCloseTo(7_200, 4);
  });

  it("uses actual days over 365 for accrued interest", () => {
    const cost = estimateInvestmentFinancingCostForPeriod(
      [loan({ remainingTermMonths: undefined, initialFees: 1_000 })],
      "2025-12-31",
      "2026-01-31"
    );

    expect(cost).toBeCloseTo(1_000 + (120_000 * 0.06 * 30) / 365, 4);
  });

  it("allocates only the investment-use share to net pnl", () => {
    const summary = calculatePortfolioLoanSummary(
      [loan({ investmentUsePercent: 60, initialFees: 1_000 })],
      { asOfDate: "2026-01-31", grossInvestmentPnl: 10_000 }
    );

    expect(summary.investmentDebt).toBeCloseTo(72_000, 2);
    expect(summary.investmentFinancingCostToDate).toBeCloseTo(
      (1_000 + (120_000 * 0.06 * 30) / 365) * 0.6,
      4
    );
    expect(summary.netInvestmentPnl).toBeCloseTo(
      10_000 - summary.investmentFinancingCostToDate,
      4
    );
  });

  it("does not put property or personal debt into investment debt", () => {
    const summary = calculatePortfolioLoanSummary(
      [
        loan({ id: "mortgage", purpose: "property", investmentUsePercent: 0 }),
        loan({ id: "personal", purpose: "personal", investmentUsePercent: 0 }),
      ],
      { asOfDate: "2026-01-15" }
    );

    expect(summary.totalDebt).toBe(240_000);
    expect(summary.propertyDebt).toBe(120_000);
    expect(summary.personalDebt).toBe(120_000);
    expect(summary.investmentDebt).toBe(0);
  });

  it("returns a current snapshot and the next scheduled payment", () => {
    const snapshot = calculateLoanSnapshot(loan(), "2026-02-01");

    expect(snapshot.currentPrincipal).toBeLessThan(120_000);
    expect(snapshot.nextPayment?.paymentDate).toBe("2026-03-01");
    expect(snapshot.projectedInterest).toBeGreaterThan(0);
  });
});
