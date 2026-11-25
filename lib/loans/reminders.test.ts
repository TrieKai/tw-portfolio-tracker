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

  it("uses the repriced installment for reminders and skips installments without a payment", () => {
    const datedRate = [{ id: "rate-12", effectiveDate: "2026-01-01", annualInterestRate: 12, createdAt: "2026-01-01T00:00:00.000Z" }];
    const repriced = loan({ repaymentMethod: "equal_principal", rateHistory: datedRate });
    expect(buildLoanReminders([repriced], [], "2026-09-01")[0])
      .toMatchObject({ kind: "payment_due", amount: 11_200, date: "2026-09-05" });
    const bullet = loan({ repaymentMethod: "bullet", remainingTermMonths: 2 });
    expect(buildLoanReminders([bullet], [], "2026-09-01")).toEqual([]);
    expect(buildLoanReminders([bullet], [], "2026-10-01")[0])
      .toMatchObject({ kind: "payment_due", amount: 121_200, date: "2026-10-05" });
  });

  it("keeps a reminder after a fee or partial payment and deducts only paid principal and interest", () => {
    const fee = { id: "fee", paymentDate: "2026-09-05", principalPaid: 0, interestPaid: 0,
      feePaid: 300, subsidyReceived: 0, createdAt: "2026-09-05T00:00:00.000Z" };
    const partial = { ...fee, id: "part", principalPaid: 5_000, interestPaid: 300, feePaid: 0 };
    const paymentDue = (paymentHistory: Loan["paymentHistory"]) => buildLoanReminders(
      [loan({ repaymentMethod: "equal_principal", paymentHistory })], [], "2026-09-05"
    ).find((reminder) => reminder.kind === "payment_due");
    expect(paymentDue([fee])).toMatchObject({ amount: 10_600 });
    expect(paymentDue([fee, partial])).toMatchObject({ amount: 5_300, message: "今天預計尚需繳款" });
    expect(paymentDue([fee, partial, { ...partial, id: "part-2" }])).toBeUndefined();
  });

  it("counts early and late receipts against their selected installment once", () => {
    const first = { id: "linked", paymentDate: "2026-09-01", installmentDueDate: "2026-09-05",
      principalPaid: 0, interestPaid: 300, feePaid: 0, subsidyReceived: 0, createdAt: "2026-09-01T00:00:00.000Z" };
    const sameDay = { ...first, id: "same-day", paymentDate: "2026-09-05", interestPaid: 100 };
    const paymentDue = (paymentHistory: Loan["paymentHistory"], asOf: string) => buildLoanReminders(
      [loan({ repaymentMethod: "equal_principal", paymentHistory })], [], asOf
    ).find((reminder) => reminder.kind === "payment_due");
    expect(paymentDue([first, sameDay], "2026-09-05")).toMatchObject({ amount: 10_200 });
    expect(paymentDue([first, sameDay], "2026-09-06")).toMatchObject({
      amount: 10_200, message: "2026-09-05 期已過應繳日，預估尚需繳款",
    });
    const late = { ...first, id: "settled", paymentDate: "2026-09-08", principalPaid: 10_000, interestPaid: 200 };
    expect(paymentDue([first, sameDay, late], "2026-09-08")).toBeUndefined();
  });
});
