import { describe, expect, it } from "vitest";
import {
  calculateLoanCollateralValuation,
  calculatePortfolioLoanRiskSummary,
} from "@/lib/loans/risk";
import type { Holding } from "@/lib/types/holding";
import type { Loan } from "@/lib/types/loan";

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "holding-1",
    assetType: "stock",
    name: "測試股票",
    symbol: "2330",
    market: "tse",
    buyPrice: 800,
    quantity: 1_000,
    buyDate: "2025-01-01",
    currentPrice: 900,
    priceDate: "2026-08-30",
    priceSource: "api",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    name: "測試質押",
    loanType: "securities_pledge",
    purpose: "investment",
    investmentUsePercent: 100,
    openingBalance: 500_000,
    trackingStartDate: "2026-08-01",
    annualInterestRate: 3,
    rateType: "floating",
    repaymentMethod: "interest_only",
    maintenanceWarningPercent: 160,
    maintenanceCallPercent: 140,
    collateralPositions: [{ holdingId: "holding-1", quantity: 1_000 }],
    status: "active",
    dataQuality: "estimated",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loan collateral risk", () => {
  it("computes maintenance ratio and price-drop buffers", () => {
    const valuation = calculateLoanCollateralValuation(
      loan(),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(900_000);
    expect(valuation.maintenanceRatioPercent).toBe(180);
    expect(valuation.warningBufferPercent).toBeCloseTo(11.1111, 3);
    expect(valuation.callBufferPercent).toBeCloseTo(22.2222, 3);
    expect(valuation.riskLevel).toBe("safe");
  });

  it("marks warning and critical levels using contract thresholds", () => {
    expect(
      calculateLoanCollateralValuation(loan(), [holding({ currentPrice: 780 })], "2026-08-30").riskLevel
    ).toBe("warning");
    expect(
      calculateLoanCollateralValuation(loan(), [holding({ currentPrice: 680 })], "2026-08-30").riskLevel
    ).toBe("critical");
  });

  it("does not use cost basis when current collateral price is missing", () => {
    const valuation = calculateLoanCollateralValuation(
      loan(),
      [holding({ currentPrice: undefined })],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(0);
    expect(valuation.missingPositionCount).toBe(1);
    expect(valuation.riskLevel).toBe("unknown");
  });

  it("does not value more collateral units than the tracked holding", () => {
    const valuation = calculateLoanCollateralValuation(
      loan({
        collateralPositions: [{ holdingId: "holding-1", quantity: 2_000 }],
      }),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(900_000);
    expect(valuation.missingPositionCount).toBe(1);
    expect(valuation.riskLevel).toBe("unknown");
  });

  it("tracks credit utilization and overdue maturity", () => {
    const valuation = calculateLoanCollateralValuation(
      loan({ creditLimit: 800_000, maturityDate: "2026-08-29" }),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.creditUtilizationPercent).toBe(62.5);
    expect(valuation.availableCredit).toBe(300_000);
    expect(valuation.riskLevel).toBe("critical");
  });

  it("summarizes monitored flexible-credit loans", () => {
    const summary = calculatePortfolioLoanRiskSummary(
      [
        loan(),
        loan({ id: "unknown", collateralPositions: [] }),
        loan({
          id: "revolving",
          loanType: "revolving_credit",
          collateralPositions: undefined,
          maintenanceWarningPercent: undefined,
          maintenanceCallPercent: undefined,
        }),
      ],
      [holding()],
      "2026-08-30"
    );

    expect(summary.monitoredLoanCount).toBe(3);
    expect(summary.unknownCount).toBe(1);
    expect(summary.lowestMaintenanceRatioPercent).toBe(180);
  });
});
