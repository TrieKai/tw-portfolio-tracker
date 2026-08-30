import { describe, expect, it } from "vitest";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import {
  addLoan,
  editLoan,
  recordLoanBalance,
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
});
