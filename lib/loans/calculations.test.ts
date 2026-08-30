import { describe, expect, it } from "vitest";
import {
  buildDailyInvestmentFinancingCosts,
  buildLoanSchedule,
  calculateLoanEffectiveApr,
  calculateLoanSnapshot,
  calculatePortfolioLoanSummary,
  estimateInvestmentFinancingCostForPeriod,
  interestRateAtDate,
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

  it("preserves dated balance changes when estimating revolving interest", () => {
    const revolving = loan({
      repaymentMethod: "revolving",
      remainingTermMonths: undefined,
      balanceHistory: [
        {
          effectiveDate: "2026-01-16",
          balance: 60_000,
          recordedAt: "2026-01-16T00:00:00.000Z",
        },
      ],
    });
    const snapshot = calculateLoanSnapshot(revolving, "2026-01-31");
    const cost = estimateInvestmentFinancingCostForPeriod(
      [revolving],
      "2025-12-31",
      "2026-01-31"
    );

    expect(snapshot.currentPrincipal).toBe(60_000);
    expect(cost).toBeCloseTo(
      (120_000 * 0.06 * 15) / 365 + (60_000 * 0.06 * 15) / 365,
      4
    );
  });

  it("does not reset a flexible interest-only balance on later interest dates", () => {
    const pledge = loan({
      loanType: "securities_pledge",
      repaymentMethod: "interest_only",
      balanceHistory: [
        {
          effectiveDate: "2026-02-15",
          balance: 60_000,
          recordedAt: "2026-02-15T00:00:00.000Z",
        },
      ],
    });

    expect(calculateLoanSnapshot(pledge, "2026-04-01")).toMatchObject({
      currentPrincipal: 60_000,
      nextPayment: null,
      projectedInterest: null,
    });
  });

  it("uses a same-day balance snapshot from the tracking start", () => {
    const revolving = loan({
      repaymentMethod: "revolving",
      remainingTermMonths: undefined,
      balanceHistory: [
        {
          effectiveDate: "2026-01-01",
          balance: 60_000,
          recordedAt: "2026-01-01T12:00:00.000Z",
        },
      ],
    });
    const cost = estimateInvestmentFinancingCostForPeriod(
      [revolving],
      "2025-12-31",
      "2026-01-02"
    );

    expect(cost).toBeCloseTo((60_000 * 0.06) / 365, 4);
  });

  it("applies rate changes only from their effective dates", () => {
    const floating = loan({
      rateType: "floating",
      remainingTermMonths: undefined,
      rateHistory: [
        {
          id: "rate-1",
          effectiveDate: "2026-01-16",
          annualInterestRate: 3,
          createdAt: "2026-01-16T00:00:00.000Z",
        },
      ],
    });
    const cost = estimateInvestmentFinancingCostForPeriod(
      [floating],
      "2025-12-31",
      "2026-01-31"
    );

    expect(interestRateAtDate(floating, "2026-01-15")).toBe(6);
    expect(interestRateAtDate(floating, "2026-01-16")).toBe(3);
    expect(cost).toBeCloseTo(
      (120_000 * 0.06 * 15) / 365 + (120_000 * 0.03 * 15) / 365,
      4
    );
  });

  it("true-ups estimated interest to the actual statement amount", () => {
    const reconciled = loan({
      remainingTermMonths: undefined,
      paymentHistory: [
        {
          id: "payment-1",
          paymentDate: "2026-02-01",
          principalPaid: 0,
          interestPaid: 610,
          feePaid: 20,
          subsidyReceived: 10,
          interestPeriodStartDate: "2026-01-01",
          interestPeriodEndDate: "2026-01-31",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    });
    const cost = estimateInvestmentFinancingCostForPeriod(
      [reconciled],
      "2025-12-31",
      "2026-02-01"
    );

    const unreconciledDay = (120_000 * 0.06) / 365;
    expect(cost).toBeCloseTo(610 + unreconciledDay + 20 - 10, 4);
  });

  it("keeps a negative reconciliation adjustment on the payment date", () => {
    const reconciled = loan({
      remainingTermMonths: undefined,
      paymentHistory: [
        {
          id: "payment-refund",
          paymentDate: "2026-02-01",
          principalPaid: 0,
          interestPaid: 100,
          feePaid: 0,
          subsidyReceived: 0,
          interestPeriodStartDate: "2026-01-01",
          interestPeriodEndDate: "2026-01-31",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    });
    const daily = buildDailyInvestmentFinancingCosts(
      [reconciled],
      "2026-02-01",
      "2026-02-01"
    );

    expect(daily["2026-02-01"]).toBeLessThan(0);
  });

  it("calculates fee-inclusive effective APR for fixed installments", () => {
    const withoutFee = calculateLoanEffectiveApr(loan());
    const withFee = calculateLoanEffectiveApr(loan({ initialFees: 2_000 }));

    expect(withoutFee).toBeGreaterThan(6);
    expect(withFee).toBeGreaterThan(withoutFee!);
    expect(calculateLoanEffectiveApr(loan({ rateType: "floating" }))).toBeNull();
  });

  it("carries an actual balance correction into later installment estimates", () => {
    const base = loan();
    const schedule = buildLoanSchedule(base);
    const correctedBalance = schedule[0].remainingPrincipal - 5_000;
    const corrected = loan({
      balanceHistory: [
        {
          effectiveDate: schedule[0].paymentDate,
          balance: correctedBalance,
          recordedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    });

    expect(
      calculateLoanSnapshot(corrected, schedule[1].paymentDate)
        .currentPrincipal
    ).toBeCloseTo(schedule[1].remainingPrincipal - 5_000, 4);
  });
});
