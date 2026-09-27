import { describe, expect, it } from "vitest";
import { buildPortfolioTimelineBetween, getUnitPriceOnDate } from "./portfolio-timeline";
import type { Holding, PricePoint } from "@/lib/types/holding";

const holding: Holding = {
  id: "lot-1",
  assetType: "stock",
  name: "測試股票",
  symbol: "2330",
  market: "tse",
  buyDate: "2026-06-10",
  buyPrice: 90,
  quantity: 10,
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

describe("portfolio timeline purchase date", () => {
  it("does not use a pre-purchase quote to value a newly purchased holding", () => {
    const history: PricePoint[] = [
      { date: "2026-06-09", price: 80, source: "api" },
      { date: "2026-06-11", price: 100, source: "api" },
    ];

    expect(getUnitPriceOnDate(holding, history, "2026-06-10")).toEqual({
      unitPrice: 90,
      hasMarketPrice: false,
    });
    expect(getUnitPriceOnDate(holding, history, "2026-06-11")).toEqual({
      unitPrice: 100,
      hasMarketPrice: true,
    });

    const timeline = buildPortfolioTimelineBetween(
      [holding],
      { [holding.id]: history },
      "2026-06-10",
      "2026-06-11"
    );
    expect(timeline.map((point) => ({ date: point.date, pnl: point.pnl }))).toEqual([
      { date: "2026-06-10", pnl: 0 },
      { date: "2026-06-11", pnl: 100 },
    ]);
  });
});
