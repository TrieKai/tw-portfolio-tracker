import { describe, expect, it } from "vitest";
import { buildWeeklyPortfolioReport } from "@/lib/portfolio/weekly-report";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import { addHolding, applyPriceUpdate, sellHolding } from "@/lib/storage/portfolio-store";

function openingPortfolio() {
  const state = addHolding(defaultPortfolioStorage(), {
    assetType: "stock", symbol: "2330", name: "期初持倉", quantity: 100,
    buyDate: "2026-11-02", buyPrice: 100,
  });
  return applyPriceUpdate(state, state.holdings[0].id, 110, "2026-11-04", "manual");
}

describe("weekly portfolio report", () => {
  it("uses the lots held at each endpoint and counts purchases independently of sales", () => {
    let state = openingPortfolio();
    const first = state.holdings[0].id;
    state = sellHolding(state, { id: first, quantity: 60, sellDate: "2026-11-09", sellPrice: 120 });
    state = addHolding(state, {
      assetType: "stock", symbol: "2317", name: "期間新增", quantity: 10,
      buyDate: "2026-11-10", buyPrice: 200,
    });
    state = applyPriceUpdate(state, first, 130, "2026-11-12", "manual");
    state = applyPriceUpdate(state, state.holdings[1].id, 210, "2026-11-12", "manual");

    expect(buildWeeklyPortfolioReport(state, "2026-11-15"))
      .toMatchObject({
        startDate: "2026-11-04", endDate: "2026-11-12",
        startValue: 11_000, endValue: 7_300, valueChange: -3_700,
        unrealizedChange: 300, realizedPnl: 1_200, newCapital: 2_000,
        topPositive: { symbol: "2330", amount: 200 },
      });
  });

  it("reports an exit on its transaction date even without a newer valuation", () => {
    let state = openingPortfolio();
    const id = state.holdings[0].id;
    state = applyPriceUpdate(state, id, 130, "2026-11-17", "manual");
    state = sellHolding(state, { id, quantity: 100, sellDate: "2026-11-12", sellPrice: 120 });

    expect(buildWeeklyPortfolioReport(state, "2026-11-25"))
      .toMatchObject({
        startDate: "2026-11-04", endDate: "2026-11-12",
        startValue: 11_000, endValue: 0, unrealizedChange: -1_000, realizedPnl: 2_000,
        topNegative: { symbol: "2330", amount: -1_000 },
      });
  });

  it("does not count a quote before the first purchase as a valuation day", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "首次買入", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    state = applyPriceUpdate(state, state.holdings[0].id, 98, "2026-10-30", "api");
    expect(buildWeeklyPortfolioReport(state, "2026-11-02")).toBeNull();
  });
});
