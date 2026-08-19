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
});
