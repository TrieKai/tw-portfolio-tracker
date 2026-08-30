import { describe, expect, it } from "vitest";
import { normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";

describe("normalizePortfolioStorage", () => {
  it("loads a version 1 backup as version 2 without user re-entry", () => {
    const normalized = normalizePortfolioStorage({
      version: 1,
      holdings: [
        {
          id: "holding-1",
          assetType: "fund",
          name: "測試基金",
          symbol: "1234",
          buyPrice: 10,
          quantity: 100,
          buyDate: "2026-01-01",
          currentPrice: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
      priceHistory: {},
      sales: [],
      corporateActions: [],
      settings: { autoUpdateEnabled: false },
    });

    expect(normalized).toMatchObject({
      version: 2,
      transactions: [
        {
          type: "opening_balance",
          holdingId: "holding-1",
          quantity: 100,
          price: 12,
        },
      ],
      transactionRevisions: [],
      pnlTracking: { dailySummaries: {} },
    });
  });

  it("migrates aggregate liabilities and property mortgages once", () => {
    const normalized = normalizePortfolioStorage(
      {
        version: 2,
        holdings: [
          {
            id: "property-1",
            assetType: "property",
            name: "自住房",
            symbol: "HOME",
            buyPrice: 10_000_000,
            quantity: 1,
            buyDate: "2020-01-01",
            mortgageBalance: 6_000_000,
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        priceHistory: {},
        sales: [],
        corporateActions: [],
        transactions: [],
        transactionRevisions: [],
        pnlTracking: { startedAt: "", dailySummaries: {} },
        settings: { autoUpdateEnabled: false, liabilities: 1_000_000 },
      },
      { migratedAt: "2026-08-30T00:00:00.000Z" }
    );

    expect(normalized?.settings.liabilities).toBeUndefined();
    expect(normalized?.holdings[0].mortgageBalance).toBeUndefined();
    expect(normalized?.loans).toMatchObject([
      {
        id: "legacy-investment-liabilities",
        openingBalance: 1_000_000,
        purpose: "investment",
        dataQuality: "incomplete",
      },
      {
        id: "legacy-mortgage-property-1",
        openingBalance: 6_000_000,
        purpose: "property",
        linkedHoldingId: "property-1",
      },
    ]);

    const normalizedAgain = normalizePortfolioStorage(normalized, {
      migratedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(normalizedAgain?.loans).toHaveLength(2);
  });

  it("keeps valid collateral and balance-history fields", () => {
    const normalized = normalizePortfolioStorage({
      version: 2,
      holdings: [],
      loans: [
        {
          id: "pledge-1",
          name: "股票質押",
          loanType: "securities_pledge",
          purpose: "investment",
          investmentUsePercent: 100,
          openingBalance: 500_000,
          trackingStartDate: "2026-08-01",
          annualInterestRate: 3,
          rateType: "floating",
          repaymentMethod: "revolving",
          creditLimit: 800_000,
          maturityDate: "2027-08-01",
          maintenanceWarningPercent: 160,
          maintenanceCallPercent: 140,
          collateralPositions: [
            { holdingId: "holding-1", quantity: 1_000 },
            { holdingId: "bad", quantity: -1 },
          ],
          balanceHistory: [
            {
              effectiveDate: "2026-08-15",
              balance: 450_000,
              recordedAt: "2026-08-15T00:00:00.000Z",
            },
            { effectiveDate: "2026-07-01", balance: 600_000 },
          ],
          status: "active",
          dataQuality: "estimated",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      loanRevisions: [],
      priceHistory: {},
      sales: [],
      corporateActions: [],
      transactions: [],
      transactionRevisions: [],
      pnlTracking: { startedAt: "", dailySummaries: {} },
      settings: { autoUpdateEnabled: false },
    });

    expect(normalized?.loans[0]).toMatchObject({
      creditLimit: 800_000,
      maturityDate: "2027-08-01",
      collateralPositions: [{ holdingId: "holding-1", quantity: 1_000 }],
      balanceHistory: [
        { effectiveDate: "2026-08-15", balance: 450_000 },
      ],
    });
  });
});
