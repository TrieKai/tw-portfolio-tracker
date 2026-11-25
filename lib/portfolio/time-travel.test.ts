import { describe, expect, it } from "vitest";
import { buildPortfolioTimelineBetween } from "@/lib/portfolio/portfolio-timeline";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import { addHolding, applyManualCorporateAction, applyPriceUpdate, sellHolding } from "@/lib/storage/portfolio-store";

function startingPortfolio() {
  return addHolding(defaultPortfolioStorage(), {
    assetType: "stock",
    name: "測試股票",
    symbol: "2330",
    buyDate: "2026-11-02",
    quantity: 100,
    buyPrice: 100,
  });
}

describe("historical portfolio positions", () => {
  it("restores the historical quantity across partial and complete sales", () => {
    let state = startingPortfolio();
    const id = state.holdings[0].id;
    state = applyPriceUpdate(state, id, 110, "2026-11-03", "manual");
    state = sellHolding(state, { id, quantity: 30, sellPrice: 120, sellDate: "2026-11-05" });
    state = sellHolding(state, { id, quantity: 70, sellPrice: 125, sellDate: "2026-11-10" });
    expect(state.holdings).toHaveLength(0);
    const history = buildPortfolioHistory(state);

    expect(history.snapshotOn("2026-11-03")[0]).toMatchObject({ quantity: 100, currentPrice: 110 });
    expect(history.snapshotOn("2026-11-05")[0]).toMatchObject({ quantity: 70, buyPrice: 100 });
    expect(history.snapshotOn("2026-11-10")).toEqual([]);
    const points = buildPortfolioTimelineBetween([], state.priceHistory, "2026-11-01", "2026-11-20", history);
    expect(points.map(({ date, totalCost, totalValue }) => [date, totalCost, totalValue])).toEqual([
      ["2026-11-02", 10_000, 10_000],
      ["2026-11-03", 10_000, 11_000],
      ["2026-11-05", 7_000, 7_700],
      ["2026-11-10", 0, 0],
    ]);
  });

  it("uses the original units and price at the selected date before a split", () => {
    let state = startingPortfolio();
    const id = state.holdings[0].id;
    state = applyPriceUpdate(state, id, 110, "2026-11-03", "manual");
    state = sellHolding(state, { id, quantity: 30, sellPrice: 120, sellDate: "2026-11-04" });
    state = applyManualCorporateAction(state, {
      holdingId: id, effectiveDate: "2026-11-05", actionType: "split", adjustmentRatio: 2,
    });
    const history = buildPortfolioHistory(state);

    expect(history.snapshotOn("2026-11-03")[0]).toMatchObject({ quantity: 100, buyPrice: 100, currentPrice: 110 });
    expect(history.snapshotOn("2026-11-05")[0]).toMatchObject({ quantity: 140, buyPrice: 50, currentPrice: 55 });
  });

  it("keeps old sales with no known opening date out of reconstructed positions", () => {
    let state = startingPortfolio();
    const id = state.holdings[0].id;
    state = sellHolding(state, { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-04" });
    const legacy = { ...state, transactions: [], sales: state.sales.map((sale) => ({ ...sale, buyDate: undefined })) };
    const history = buildPortfolioHistory(legacy);

    expect(history.unknownStartCount).toBe(1);
    expect(history.snapshotOn("2026-11-03")).toEqual([]);
  });
});
