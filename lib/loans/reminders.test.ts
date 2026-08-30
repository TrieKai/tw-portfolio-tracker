import { describe, expect, it } from "vitest";
import { buildLoanReminders } from "@/lib/loans/reminders";
import type { Loan } from "@/lib/types/loan";

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    name: "提醒測試貸款",
    loanType: "personal_credit",
    purpose: "investment",
    investmentUsePercent: 100,
    openingBalance: 120_000,
    trackingStartDate: "2026-01-01",
    remainingTermMonths: 12,
    firstPaymentDate: "2026-09-05",
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

describe("loan reminders", () => {
  it("shows near payment and maturity reminders", () => {
    const reminders = buildLoanReminders(
      [loan({ maturityDate: "2026-09-20" })],
      [],
      "2026-09-01"
    );

    expect(reminders.map((reminder) => reminder.kind)).toEqual([
      "maturity_due",
      "payment_due",
    ]);
  });

  it("does not remind a payment already recorded on the due date", () => {
    const reminders = buildLoanReminders(
      [
        loan({
          paymentHistory: [
            {
              id: "paid",
              paymentDate: "2026-09-05",
              principalPaid: 10_000,
              interestPaid: 500,
              feePaid: 0,
              subsidyReceived: 0,
              interestPeriodStartDate: "2026-08-05",
              interestPeriodEndDate: "2026-09-05",
              createdAt: "2026-09-05T00:00:00.000Z",
            },
          ],
        }),
      ],
      [],
      "2026-09-01"
    );

    expect(reminders).toEqual([]);
  });

  it("flags unreconciled actual interest", () => {
    const reminders = buildLoanReminders(
      [
        loan({
          paymentHistory: [
            {
              id: "unreconciled",
              paymentDate: "2026-08-05",
              principalPaid: 0,
              interestPaid: 500,
              feePaid: 0,
              subsidyReceived: 0,
              createdAt: "2026-08-05T00:00:00.000Z",
            },
          ],
        }),
      ],
      [],
      "2026-09-01"
    );

    expect(reminders.some((reminder) => reminder.kind === "unreconciled_interest")).toBe(true);
  });
});
