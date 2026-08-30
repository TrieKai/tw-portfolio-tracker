import { describe, expect, it } from "vitest";
import { computePortfolioExposure } from "@/lib/portfolio/exposure";
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
