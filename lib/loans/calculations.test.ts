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

  it("updates projected installments for dated rate changes without charging the old days at the new rate", () => {
    const rate = (effectiveDate: string, annualInterestRate: number) => ({
      id: effectiveDate, effectiveDate, annualInterestRate, createdAt: `${effectiveDate}T00:00:00.000Z`,
    });
    const repriced = loan({ repaymentMethod: "equal_principal", rateType: "floating", rateHistory: [
      rate("2026-02-01", 12), rate("2026-01-17", 12.2),
    ] });
    const forecast = calculateLoanSnapshot(repriced, "2026-01-20");
    expect(forecast.nextPayment).toMatchObject({ paymentDate: "2026-02-01", principal: 10_000, interest: 900, payment: 10_900 });
    expect(forecast.schedule[1]).toMatchObject({ principal: 10_000, interest: 1_100, remainingPrincipal: 100_000 });
    expect(calculatePortfolioLoanSummary([repriced], { asOfDate: "2026-01-20" }).nextPaymentAmount).toBe(10_900);
  });

  it("uses a mid-period principal snapshot in the forecast and never projects negative principal", () => {
    const loanWithBalance = loan({ repaymentMethod: "equal_principal", balanceHistory: [{
      effectiveDate: "2026-02-15", balance: 60_000, recordedAt: "2026-02-15T00:00:00.000Z",
    }] });
    const result = calculateLoanSnapshot(loanWithBalance, "2026-02-20");
    expect(result.currentPrincipal).toBe(60_000);
    expect(result.nextPayment).toMatchObject({ openingPrincipal: 60_000, interest: 425, payment: 10_425, remainingPrincipal: 50_000 });
    expect(result.schedule.findLast((row) => row.payment > 0)?.installment).toBe(7);
    expect(result.schedule.every((row) => row.remainingPrincipal >= 0)).toBe(true);
    expect(calculateLoanSnapshot(loanWithBalance, "2026-08-01").nextPayment).toBeNull();
  });

  it("recalculates equal payments for the remaining periods when the rate changes", () => {
    const base = loan({ openingBalance: 12_000, remainingTermMonths: 3, annualInterestRate: 0 });
    const repriced = { ...base, rateHistory: [{ id: "new-rate", effectiveDate: "2026-02-01",
      annualInterestRate: 12, createdAt: "2026-02-01T00:00:00.000Z" }] };
    const [first, second, third] = buildLoanSchedule(repriced);
    expect(first.payment).toBe(4_000);
    expect(second).toMatchObject({ openingPrincipal: 8_000, interest: 80 });
    expect(second.payment).toBeGreaterThan(4_000);
    expect(third.payment).toBeCloseTo(second.payment, 4);
    expect(third.remainingPrincipal).toBe(0);
  });

  it.each(["equal_principal", "equal_payment"] as const)("allocates early installments without double-counting %s principal", (repaymentMethod) => {
    const base = loan({ repaymentMethod });
    const first = buildLoanSchedule(base)[0];
    const balance = 120_000 - first.principal;
    const paid = {
      ...base,
      paymentHistory: [{ id: "early", paymentDate: "2026-01-25", installmentDueDate: "2026-02-01",
        principalPaid: first.principal, interestPaid: first.interest, feePaid: 0, subsidyReceived: 0,
        remainingPrincipalAfter: balance, createdAt: "2026-01-25T00:00:00.000Z" }],
      balanceHistory: [{ effectiveDate: "2026-01-25", balance, recordedAt: "2026-01-25T00:00:00.000Z" }],
    };
    const snapshot = calculateLoanSnapshot(paid, "2026-01-26");
    expect(snapshot.schedule[0]).toMatchObject({ payment: 0, principal: 0, creditedAmount: first.payment });
    expect(snapshot.nextPayment?.paymentDate).toBe("2026-03-01");
    expect(calculateLoanSnapshot(paid, "2026-02-01").currentPrincipal).toBeCloseTo(balance, 5);
    expect(snapshot.effectiveAprPercent).toBe(calculateLoanEffectiveApr(base));
    expect(calculateLoanSnapshot(paid, "2026-01-26").currentPrincipal).toBeCloseTo(balance, 5);
  });

  it("keeps known late principal outstanding until the receipt date and recognizes fees on that date", () => {
    const base = loan({ repaymentMethod: "equal_principal" });
    const paid = { ...base, paymentHistory: [{ id: "late", paymentDate: "2026-02-04", installmentDueDate: "2026-02-01",
      principalPaid: 10_000, interestPaid: 600, feePaid: 90, subsidyReceived: 0,
      remainingPrincipalAfter: 110_000, createdAt: "2026-02-04T00:00:00.000Z" }],
    balanceHistory: [{ effectiveDate: "2026-02-04", balance: 110_000, recordedAt: "2026-02-04T00:00:00.000Z" }] };
    const dailyInterest = (120_000 * 0.06) / 365;
    const days = buildDailyInvestmentFinancingCosts([paid], "2026-02-01", "2026-02-05");
    expect(calculateLoanSnapshot(paid, "2026-02-02").currentPrincipal).toBe(120_000);
    expect(calculateLoanSnapshot(paid, "2026-02-04").currentPrincipal).toBe(110_000);
    expect(days["2026-02-01"]).toBeCloseTo(dailyInterest, 5);
    expect(days["2026-02-03"]).toBeCloseTo(dailyInterest, 5);
    expect(days["2026-02-04"]).toBeCloseTo(dailyInterest + 90, 5);
    expect(days["2026-02-05"]).toBeCloseTo((110_000 * 0.06) / 365, 5);

    const partial = { ...paid,
      paymentHistory: [{ ...paid.paymentHistory[0], principalPaid: 5_000, interestPaid: 350, remainingPrincipalAfter: 115_000 }],
      balanceHistory: [{ ...paid.balanceHistory[0], balance: 115_000 }],
    };
    expect(buildLoanSchedule(partial)[0]).toMatchObject({ payment: 5_250, principal: 5_000 });
    expect(calculateLoanSnapshot(partial, "2026-02-02").currentPrincipal).toBe(120_000);
    expect(calculateLoanSnapshot(partial, "2026-02-04").currentPrincipal).toBe(115_000);
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

  it("uses the new principal and final rate together after a same-day change", () => {
    const repriced = loan({ repaymentMethod: "revolving", remainingTermMonths: undefined, rateType: "floating",
      balanceHistory: [{ effectiveDate: "2026-01-16", balance: 60_000, recordedAt: "2026-01-16T03:00:00.000Z" }],
      rateHistory: [
        { id: "final-rate", effectiveDate: "2026-01-16", annualInterestRate: 3, createdAt: "2026-01-16T04:00:00.000Z" },
        { id: "older-rate", effectiveDate: "2026-01-16", annualInterestRate: 4, createdAt: "2026-01-16T02:00:00.000Z" },
      ],
    });
    const expected = (120_000 * 0.06 * 15 + 60_000 * 0.03 * 15) / 365;
    const daily = buildDailyInvestmentFinancingCosts([repriced], "2026-01-01", "2026-01-31");
    expect(daily["2026-01-16"]).toBeCloseTo((120_000 * 0.06) / 365, 5);
    expect(daily["2026-01-17"]).toBeCloseTo((60_000 * 0.03) / 365, 5);
    expect(Object.values(daily).reduce((total, cost) => total + cost, 0)).toBeCloseTo(expected, 4);
    const snapshot = calculateLoanSnapshot(repriced, "2026-01-31");
    expect(snapshot.currentPrincipal).toBe(60_000);
    expect(snapshot.currentAnnualInterestRate).toBe(3);
    expect(snapshot.estimatedFinancingCostToDate).toBeCloseTo(expected, 5);
    expect(calculatePortfolioLoanSummary([repriced], { asOfDate: "2026-01-31" }).investmentFinancingCostToDate)
      .toBeCloseTo(expected, 5);

    const withReceipt = { ...repriced, paymentHistory: [{ id: "receipt", paymentDate: "2026-02-01",
      principalPaid: 0, interestPaid: 350, feePaid: 10, subsidyReceived: 5,
      interestPeriodStartDate: "2026-01-01", interestPeriodEndDate: "2026-01-31", createdAt: "2026-02-01T02:00:00.000Z",
    }] };
    const withReceiptDaily = buildDailyInvestmentFinancingCosts([withReceipt], "2026-01-01", "2026-02-01");
    const costAfterReceipt = 350 + 10 - 5 + (60_000 * 0.03) / 365;
    expect(withReceiptDaily["2026-02-01"]).toBeCloseTo(costAfterReceipt - expected, 5);
    expect(Object.values(withReceiptDaily).reduce((total, cost) => total + cost, 0)).toBeCloseTo(costAfterReceipt, 4);
    expect(calculateLoanSnapshot(withReceipt, "2026-02-01").estimatedFinancingCostToDate).toBeCloseTo(costAfterReceipt, 5);
  });

  it("uses a recorded balance over the scheduled principal due on the same date", () => {
    const scheduled = loan({ repaymentMethod: "equal_principal" });
    const recorded = { ...scheduled, balanceHistory: [{ effectiveDate: "2026-02-01", balance: 80_000,
      recordedAt: "2026-02-01T10:00:00.000Z" }] };
    expect(buildLoanSchedule(recorded)[0].remainingPrincipal).toBe(110_000);
    const expected = (120_000 * 0.06 * 31 + 80_000 * 0.06 * 10) / 365;
    const daily = buildDailyInvestmentFinancingCosts([recorded], "2026-01-01", "2026-02-11");
    expect(Object.values(daily).reduce((total, cost) => total + cost, 0)).toBeCloseTo(expected, 4);
    const snapshot = calculateLoanSnapshot(recorded, "2026-02-11");
    expect(snapshot.currentPrincipal).toBe(80_000);
    expect(snapshot.estimatedFinancingCostToDate).toBeCloseTo(expected, 5);
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

  it("subtracts estimated interest for overlapping statement periods only once", () => {
    const first = {
      id: "statement-a", paymentDate: "2026-02-01", principalPaid: 0, interestPaid: 310,
      feePaid: 20, subsidyReceived: 0, interestPeriodStartDate: "2026-01-01",
      interestPeriodEndDate: "2026-01-31", createdAt: "2026-02-01T00:00:00.000Z",
    };
    const second = {
      ...first, id: "statement-b", paymentDate: "2026-02-03", interestPaid: 310,
      feePaid: 0, subsidyReceived: 10, createdAt: "2026-02-03T00:00:00.000Z",
    };
    const sample = loan({ remainingTermMonths: undefined, paymentHistory: [second, first] });
    const interestPerDay = (120_000 * 0.06) / 365;
    const total = estimateInvestmentFinancingCostForPeriod([sample], "2025-12-31", "2026-02-03");
    expect(total).toBeCloseTo(310 + 310 + 20 - 10 + 3 * interestPerDay, 4);
    const daily = buildDailyInvestmentFinancingCosts([sample], "2026-01-01", "2026-02-03");
    expect(daily["2026-02-03"]).toBeCloseTo(310 - 10 + interestPerDay, 4);
    expect(Object.values(daily).reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(total, 4);

    const overlapping = loan({ ...sample, paymentHistory: [first, {
      ...second, interestPeriodStartDate: "2026-01-15", interestPeriodEndDate: "2026-02-02",
    }] });
    expect(estimateInvestmentFinancingCostForPeriod([overlapping], "2025-12-31", "2026-02-03"))
      .toBeCloseTo(310 + 310 + 20 - 10 + interestPerDay, 4);
  });

  it("calculates fee-inclusive effective APR for fixed installments", () => {
    const withoutFee = calculateLoanEffectiveApr(loan());
    const withFee = calculateLoanEffectiveApr(loan({ initialFees: 2_000 }));

    expect(withoutFee).toBeGreaterThan(6);
    expect(withFee).toBeGreaterThan(withoutFee!);
    expect(calculateLoanEffectiveApr(loan({ rateType: "floating" }))).toBeNull();
  });

  it("preserves the fixed-contract APR when a retained rate date falls after payoff", () => {
    const closed = loan({ status: "paid_off", closedAt: "2026-05-01", initialFees: 2_000 });
    const laterRate = { ...closed, rateHistory: [{ id: "out-of-range", effectiveDate: "2026-05-15",
      annualInterestRate: 12, createdAt: "2026-05-15T00:00:00.000Z" }] };
    expect(calculateLoanEffectiveApr(closed)).not.toBeNull();
    expect(calculateLoanEffectiveApr(laterRate)).toBe(calculateLoanEffectiveApr(closed));
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

    const next = calculateLoanSnapshot(corrected, schedule[0].paymentDate);
    expect(next.currentPrincipal).toBeCloseTo(correctedBalance, 4);
    expect(next.nextPayment?.payment).toBeCloseTo(schedule[1].payment, 4);
    expect(next.nextPayment?.interest).toBeCloseTo(schedule[1].interest - 5_000 * 0.06 / 12, 4);
    expect(calculateLoanSnapshot(corrected, schedule[1].paymentDate).currentPrincipal)
      .toBeCloseTo(next.nextPayment!.remainingPrincipal, 4);
    expect(next.effectiveAprPercent).toBe(calculateLoanEffectiveApr(base));
  });
});
