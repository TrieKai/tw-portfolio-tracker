import { describe, expect, it } from "vitest";
import { computePortfolioExposure } from "@/lib/portfolio/exposure";
import { calculatePortfolioLoanSummary } from "@/lib/loans/calculations";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import type { Loan } from "@/lib/types/loan";

const property: HoldingWithMetrics = {
  id: "home",
  assetType: "property",
  name: "自住房",
  symbol: "HOME",
  buyPrice: 10_000_000,
  quantity: 1,
  buyDate: "2020-01-01",
  currentPrice: 12_000_000,
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  costBasis: 10_000_000,
  marketValue: 12_000_000,
  pnl: 2_000_000,
  returnRate: 20,
  hasLivePrice: true,
};

function loan(overrides: Partial<Loan>): Loan {
  return {
    id: "loan",
    name: "貸款",
    loanType: "other",
    purpose: "personal",
    investmentUsePercent: 0,
    openingBalance: 1_000_000,
    trackingStartDate: "2026-01-01",
    annualInterestRate: 0,
    rateType: "fixed",
    repaymentMethod: "revolving",
    status: "active",
    dataQuality: "complete",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("portfolio exposure with loans", () => {
  it("shows negative equity when eligible debt is larger than the assets", () => {
    const mortgage = loan({ purpose: "property", openingBalance: 13_000_000, linkedHoldingId: "home" });
    expect(computePortfolioExposure([property], {}, [mortgage], "2026-08-30")).toMatchObject({
      netAssets: -1_000_000, exposureRatioPct: null,
    });
  });

  it("allocates each loan principal once even when an old backup has a stale investment percentage", () => {
    const loans = [
      loan({ id: "mortgage", purpose: "property", linkedHoldingId: "home", openingBalance: 6_000_000, investmentUsePercent: 100, annualInterestRate: 3 }),
      loan({ id: "personal", purpose: "personal", openingBalance: 500_000, investmentUsePercent: 40, annualInterestRate: 3 }),
      loan({ id: "mixed", purpose: "mixed", openingBalance: 1_000_000, investmentUsePercent: 40 }),
    ];
    const asOfDate = "2026-08-30";
    expect(computePortfolioExposure([property], {}, loans, asOfDate)).toMatchObject({
      netAssets: 5_600_000, investmentLiabilities: 400_000, propertyMortgages: 6_000_000,
      personalLiabilities: 1_100_000, totalLiabilities: 7_500_000,
    });
    expect(calculatePortfolioLoanSummary(loans, { asOfDate })).toMatchObject({
      investmentDebt: 400_000, propertyDebt: 6_000_000, personalDebt: 1_100_000,
      investmentFinancingCostToDate: 0, monthlyInvestmentFinancingCost: 0,
    });
  });

  it("subtracts property and investment debt but not personal debt", () => {
    const exposure = computePortfolioExposure(
      [property],
      {},
      [
        loan({
          id: "mortgage",
          purpose: "property",
          loanType: "mortgage",
          linkedHoldingId: "home",
          openingBalance: 6_000_000,
        }),
        loan({
          id: "investment",
          purpose: "investment",
          investmentUsePercent: 100,
          openingBalance: 1_000_000,
        }),
        loan({ id: "personal", openingBalance: 500_000 }),
      ],
      "2026-08-30"
    );

    expect(exposure.propertyMortgages).toBe(6_000_000);
    expect(exposure.investmentLiabilities).toBe(1_000_000);
    expect(exposure.personalLiabilities).toBe(500_000);
    expect(exposure.totalLiabilities).toBe(7_500_000);
    expect(exposure.netAssets).toBe(5_000_000);
    expect(exposure.rows[0].mortgageBalance).toBe(6_000_000);
  });
});
