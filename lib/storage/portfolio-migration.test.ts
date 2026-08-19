import { describe, expect, it } from "vitest";
import { migratePortfolioStorage } from "@/lib/storage/portfolio-migration";

describe("migratePortfolioStorage", () => {
  it("keeps legacy data and creates an opening position for accurate tracking", () => {
    const legacy = {
      version: 1,
      holdings: [
        {
          id: "holding-1",
          assetType: "stock",
          name: "測試股票",
          symbol: "2330",
          market: "tse",
          buyPrice: 90,
          quantity: 10,
          buyDate: "2026-06-01",
          currentPrice: 105,
          priceDate: "2026-08-18",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-08-18T00:00:00.000Z",
        },
      ],
      priceHistory: {
        "holding-1": [
          { date: "2026-08-18", price: 105, source: "api" },
        ],
      },
      sales: [],
      corporateActions: [],
      settings: { autoUpdateEnabled: false },
    };

    const migrated = migratePortfolioStorage(legacy, {
      migratedAt: "2026-08-19T08:00:00.000Z",
    });

    expect(migrated).toMatchObject({
      version: 2,
      holdings: legacy.holdings,
      priceHistory: legacy.priceHistory,
      transactions: [
        {
          type: "opening_balance",
          holdingId: "holding-1",
          date: "2026-08-19",
          quantity: 10,
          price: 105,
          quality: "complete",
          source: "migration",
        },
      ],
      transactionRevisions: [],
      pnlTracking: {
        startedAt: "2026-08-19",
        dailySummaries: {},
      },
    });
  });
});
