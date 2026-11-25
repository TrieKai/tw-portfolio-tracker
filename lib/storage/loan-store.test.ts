import { describe, expect, it } from "vitest";
import { buildDailyInvestmentFinancingCosts, principalAtDate } from "@/lib/loans/calculations";
import { addDaysToIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import {
  addLoan,
  editLoan,
  recordLoanBalance,
  recordLoanPayment,
  recordLoanRateChange,
  restartLoan,
  setLoanStatus,
} from "@/lib/storage/loan-store";
import type { CreateLoanInput } from "@/lib/types/loan";

const input: CreateLoanInput = {
  name: "投資信貸",
  lender: "測試銀行",
  loanType: "personal_credit",
  purpose: "investment",
  investmentUsePercent: 100,
  openingBalance: 1_000_000,
  trackingStartDate: "2026-08-30",
  remainingTermMonths: 60,
  firstPaymentDate: "2026-09-30",
  annualInterestRate: 3,
  rateType: "fixed",
  repaymentMethod: "equal_payment",
  dataQuality: "complete",
};

describe("loan store", () => {
  it("adds and normalizes a loan", () => {
    const next = addLoan(defaultPortfolioStorage(), {
      ...input,
      name: "  投資信貸  ",
      investmentUsePercent: 120,
    });

    expect(next.loans[0]).toMatchObject({
      name: "投資信貸",
      investmentUsePercent: 100,
      status: "active",
    });
  });

  it("keeps a revision when contract data is corrected", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const loan = added.loans[0];
    const corrected = editLoan(added, {
      ...input,
      id: loan.id,
      annualInterestRate: 2.8,
    });

    expect(corrected.loans[0].annualInterestRate).toBe(2.8);
    expect(corrected.loanRevisions[0]).toMatchObject({
      loanId: loan.id,
      previous: { annualInterestRate: 3 },
    });
  });

  it("archives a paid loan without deleting history", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const next = setLoanStatus(
      added,
      added.loans[0].id,
      "paid_off",
      "2026-08-30"
    );

    expect(next.loans[0]).toMatchObject({
      status: "paid_off",
      closedAt: "2026-08-30",
    });
  });

  it("keeps the closed interval interest-free when a new tracking period starts", () => {
    const contract = { ...input, repaymentMethod: "revolving" as const };
    const added = addLoan(defaultPortfolioStorage(), contract);
    const id = added.loans[0].id;
    const closed = setLoanStatus(added, id, "paid_off", "2026-09-03");
    const next = restartLoan(closed, id, { ...contract, trackingStartDate: "2026-09-10" });

    expect(next.loans[0]).toMatchObject({ status: "paid_off", closedAt: "2026-09-03" });
    expect(next.loans[1]).toMatchObject({ status: "active", restartedFromLoanId: id, trackingStartDate: "2026-09-10" });
    const costs = buildDailyInvestmentFinancingCosts(next.loans, "2026-09-01", "2026-09-12");
    expect(costs["2026-09-02"]).toBeGreaterThan(0);
    expect(costs["2026-09-05"]).toBeUndefined();
    expect(costs["2026-09-11"]).toBeGreaterThan(0);
    expect(restartLoan(next, id, contract)).toBe(next);
    expect(setLoanStatus(next, id, "active", "2026-09-11")).toBe(next);

    const undone = setLoanStatus(closed, id, "active", "2026-09-11");
    expect(buildDailyInvestmentFinancingCosts(undone.loans, "2026-09-05", "2026-09-06")["2026-09-05"]).toBeGreaterThan(0);
  });

  it("records and replaces a dated balance snapshot", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const loanId = added.loans[0].id;
    const recorded = recordLoanBalance(
      added,
      loanId,
      800_000,
      "2026-09-01",
      "2026-09-01T00:00:00.000Z"
    );
    const replaced = recordLoanBalance(
      recorded,
      loanId,
      750_000,
      "2026-09-01",
      "2026-09-01T12:00:00.000Z"
    );

    expect(replaced.loans[0].balanceHistory).toEqual([
      {
        effectiveDate: "2026-09-01",
        balance: 750_000,
        recordedAt: "2026-09-01T12:00:00.000Z",
      },
    ]);
  });

  it("records an immutable payment and its ending balance", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const loanId = added.loans[0].id;
    const next = recordLoanPayment(
      added,
      loanId,
      {
        paymentDate: "2026-09-30",
        principalPaid: 15_000,
        interestPaid: 2_500,
        feePaid: 10,
        subsidyReceived: 0,
        remainingPrincipalAfter: 985_000,
        interestPeriodStartDate: "2026-08-30",
        interestPeriodEndDate: "2026-09-30",
      },
      "2026-09-30T12:00:00.000Z"
    );

    expect(next.loans[0].paymentHistory?.[0]).toMatchObject({
      principalPaid: 15_000,
      interestPaid: 2_500,
    });
    expect(next.loans[0].balanceHistory?.[0]).toMatchObject({
      effectiveDate: "2026-09-30",
      balance: 985_000,
    });
  });

  it("rejects an interest reconciliation period outside the tracked loan", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const loanId = added.loans[0].id;
    const next = recordLoanPayment(added, loanId, {
      paymentDate: "2026-09-30",
      principalPaid: 0,
      interestPaid: 2_500,
      feePaid: 0,
      subsidyReceived: 0,
      interestPeriodStartDate: "2026-08-01",
      interestPeriodEndDate: "2026-10-01",
    });

    expect(next).toBe(added);
  });

  it("records backdated payments using the principal recorded for that date", () => {
    const started = addLoan(defaultPortfolioStorage(), {
      ...input, repaymentMethod: "revolving", openingBalance: 100_000,
    });
    const id = started.loans[0].id;
    const later = recordLoanBalance(started, id, 50_000, "2026-09-20");
    const payment = { paymentDate: "2026-09-12", principalPaid: 10_000,
      interestPaid: 0, feePaid: 0, subsidyReceived: 0, remainingPrincipalAfter: 90_000 };
    const paid = recordLoanPayment(later, id, payment);
    expect(paid.loans[0].paymentHistory).toHaveLength(1);
    expect(principalAtDate(paid.loans[0], "2026-09-12")).toBe(90_000);
    expect(principalAtDate(paid.loans[0], "2026-09-20")).toBe(50_000);
    expect(recordLoanPayment(later, id, { ...payment, remainingPrincipalAfter: 105_000 })).toBe(later);
    expect(recordLoanPayment(paid, id, { ...payment, remainingPrincipalAfter: 95_000 })).toBe(paid);
  });

  it("allows a closing-day payment while rejecting dates outside the archived loan", () => {
    const started = addLoan(defaultPortfolioStorage(), { ...input, repaymentMethod: "revolving" });
    const id = started.loans[0].id;
    const closed = setLoanStatus(started, id, "paid_off", "2026-09-20");
    const payment = { paymentDate: "2026-09-20", principalPaid: 1_000_000, interestPaid: 0,
      feePaid: 200, subsidyReceived: 0, remainingPrincipalAfter: 0 };
    const paid = recordLoanPayment(closed, id, payment);
    expect(paid.loans[0]).toMatchObject({ status: "paid_off", closedAt: "2026-09-20", paymentHistory: [payment] });
    expect(buildDailyInvestmentFinancingCosts(paid.loans, "2026-09-20", "2026-09-21")['2026-09-21']).toBeUndefined();
    expect(recordLoanPayment(closed, id, { ...payment, paymentDate: "2026-09-21" })).toBe(closed);
    expect(recordLoanPayment(started, id, { ...payment, paymentDate: "2026-09-31" })).toBe(started);
    expect(recordLoanPayment(started, id, { ...payment, paymentDate: addDaysToIsoDate(todayIsoDate(), 1) })).toBe(started);
    expect(recordLoanBalance(closed, id, 0, "2026-09-21")).toBe(closed);
    expect(setLoanStatus(paid, id, "refinanced", "2026-09-19")).toBe(paid);
  });

  it("requires an ending balance when principal was repaid", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const next = recordLoanPayment(added, added.loans[0].id, {
      paymentDate: "2026-09-30",
      principalPaid: 10_000,
      interestPaid: 2_500,
      feePaid: 0,
      subsidyReceived: 0,
    });

    expect(next).toBe(added);
  });

  it("keeps dated rate changes instead of rewriting the contract rate", () => {
    const added = addLoan(defaultPortfolioStorage(), input);
    const loanId = added.loans[0].id;
    const next = recordLoanRateChange(
      added,
      loanId,
      {
        effectiveDate: "2026-10-01",
        annualInterestRate: 2.75,
        note: "指標利率調整",
      },
      "2026-10-01T00:00:00.000Z"
    );

    expect(next.loans[0].annualInterestRate).toBe(3);
    expect(next.loans[0].rateHistory?.[0]).toMatchObject({
      effectiveDate: "2026-10-01",
      annualInterestRate: 2.75,
    });
  });

  it("keeps pre-tracking events only in the revision after correcting the start date", () => {
    const added = addLoan(defaultPortfolioStorage(), {
      ...input,
      balanceHistory: [
        {
          effectiveDate: "2026-09-01",
          balance: 990_000,
          recordedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      paymentHistory: [
        {
          id: "payment-old",
          paymentDate: "2026-09-01",
          principalPaid: 10_000,
          interestPaid: 1_000,
          feePaid: 0,
          subsidyReceived: 0,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      rateHistory: [
        {
          id: "rate-old",
          effectiveDate: "2026-09-01",
          annualInterestRate: 2.9,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    const next = editLoan(added, {
      ...input,
      id: added.loans[0].id,
      trackingStartDate: "2026-09-15",
    });

    expect(next.loans[0].balanceHistory).toBeUndefined();
    expect(next.loans[0].paymentHistory).toBeUndefined();
    expect(next.loans[0].rateHistory).toBeUndefined();
    expect(next.loanRevisions[0].previous.paymentHistory).toHaveLength(1);
  });
});
