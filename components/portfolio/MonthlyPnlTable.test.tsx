import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthlyPnlTable } from "@/components/portfolio/MonthlyPnlTable";
import { buildMonthlyPerformance } from "@/lib/portfolio/monthly-performance";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { addLoan } from "@/lib/storage/loan-store";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import type { PortfolioStorage } from "@/lib/types/holding";
import { AmountPrivacyProvider } from "@/providers/AmountPrivacyProvider";

function render(storage: PortfolioStorage, asOfDate: string) {
  return renderToStaticMarkup(
    <AmountPrivacyProvider>
      <MonthlyPnlTable storage={storage} asOfDate={asOfDate} />
    </AmountPrivacyProvider>
  );
}

describe("monthly performance table", () => {
  it("shows a retained daily summary after all detailed holdings and prices are gone", () => {
    const state = defaultPortfolioStorage();
    state.pnlTracking.dailySummaries["2025-10-08"] = {
      date: "2025-10-08", pnl: 480, returnRate: 4.8, quality: "complete", computedAt: "2025-10-08T08:00:00Z",
    };
    const html = render(state, "2025-11-01");
    expect(html).toContain("2025年10月");
    expect(html).toContain("$480");
    expect(html).not.toContain("顯示更早月份");
  });

  it("shows a month with financing costs alone", () => {
    const state = addLoan(defaultPortfolioStorage(), {
      name: "投資貸款", loanType: "revolving_credit", purpose: "investment", investmentUsePercent: 100,
      rateType: "floating", repaymentMethod: "revolving", openingBalance: 100_000, annualInterestRate: 3.65,
      trackingStartDate: "2026-11-10", dataQuality: "complete",
    });
    const html = render(state, "2026-11-25");
    expect(html).toContain("2026年11月");
    expect(html).toContain("僅有融資成本");
    expect(html).toContain("$150");
  });

  it("uses the selected year for archived months and matches calendar financing", () => {
    const state = addLoan(defaultPortfolioStorage(), {
      name: "投資貸款", loanType: "revolving_credit", purpose: "investment", investmentUsePercent: 80,
      rateType: "floating", repaymentMethod: "revolving", openingBalance: 81_700, annualInterestRate: 4.1,
      trackingStartDate: "2025-01-05", dataQuality: "complete",
    });
    for (const date of ["2024-12-06", "2025-01-08", "2025-01-23", "2025-02-05"]) {
      state.pnlTracking.dailySummaries[date] = {
        date, pnl: 100, returnRate: 1, quality: "complete", computedAt: `${date}T08:00:00Z`, returnBase: 10_000,
      };
    }
    const asOfDate = "2025-01-20";
    const calendar = buildPnlCalendar(state, { month: "2025-01", asOfDate, filter: { kind: "investment" }, includeFinancingCosts: true });
    const collapsed = buildMonthlyPerformance(state, asOfDate);
    expect(collapsed.hasEarlierMonths).toBe(true);
    expect(collapsed.rows).toMatchObject([{
      monthPrefix: "2025-01",
      investmentPnl: 100,
      dataDayCount: 1,
      completeDayCount: 1,
      returnRate: 1,
      netPnl: calendar.summary.pnl,
      financingCost: calendar.summary.financingCost,
    }]);
    expect(buildMonthlyPerformance(state, asOfDate, true).rows.map((row) => row.monthPrefix))
      .toEqual(["2025-01", "2024-12"]);
  });
});
