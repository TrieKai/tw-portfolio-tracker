import { describe, expect, it } from "vitest";
import { groupHoldings } from "@/lib/portfolio/holding-groups";
import { computeParallelUniverse } from "@/lib/portfolio/parallel-universe";
import { buildInstrumentPriceHistory } from "@/lib/portfolio/price-history";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import {
  addHolding,
  applyImportedPriceHistory,
  applyManualCorporateActionToGroup,
  applyPriceUpdate,
  sellHolding,
} from "@/lib/storage/portfolio-store";

function splitPortfolio() {
  const terms = {
    assetType: "stock", symbol: "2330", market: "tse", name: "測試股票", quantity: 10,
  } as const;
  const key = "stock:tse:2330";
  let state = addHolding(defaultPortfolioStorage(), { ...terms, buyDate: "2026-10-01", buyPrice: 100 });
  const first = state.holdings[0].id;
  state = applyPriceUpdate(state, first, 100, "2026-10-30", "api");
  state = applyManualCorporateActionToGroup(state, key, {
    actionType: "split", adjustmentRatio: 2, effectiveDate: "2026-11-02",
  });
  state = addHolding(state, { ...terms, buyDate: "2026-11-05", buyPrice: 52 });
  const second = state.holdings[1].id;
  state = applyImportedPriceHistory(state, second, [
    { date: "2026-10-29", price: 100, source: "api" },
    { date: "2026-11-06", price: 52, source: "api" },
  ]);
  state = applyManualCorporateActionToGroup(state, key, {
    actionType: "split", adjustmentRatio: 2, effectiveDate: "2026-11-12",
  });
  state = applyPriceUpdate(state, first, 26, "2026-11-13", "api");
  state = applyPriceUpdate(state, second, 26, "2026-11-13", "api");
  return state;
}

describe("instrument price history", () => {
  it("uses the same price units for lots purchased before and after a split", () => {
    const state = splitPortfolio();
    const [group] = groupHoldings(state.holdings);
    const { points, lastShareChange } = buildInstrumentPriceHistory(group, state.priceHistory, state.corporateActions, "2026-11-25");

    expect(lastShareChange).toBe("2026-11-12");
    expect(points.map(({ date, price }) => [date, price])).toEqual([
      ["2026-10-29", 25], ["2026-10-30", 25], ["2026-11-06", 26], ["2026-11-13", 26],
    ]);
    expect(state.priceHistory[state.holdings[1].id][0].price).toBe(50);
    const result = computeParallelUniverse(points, {
      startDate: points[0].date, monthlyAmount: 10_000,
    });
    expect(result?.maxDrawdown).toBe(0);
    expect(result?.strategies.find((row) => row.id === "lumpSum")?.finalValue).toBe(20_800);
  });

  it("uses only effective changes in time travel while reversing later adjustments in storage", () => {
    const state = splitPortfolio();
    const history = buildPortfolioHistory(state);
    const betweenSplits = "2026-11-10";
    const [group] = groupHoldings(history.snapshotOn(betweenSplits));
    const { points, lastShareChange } = buildInstrumentPriceHistory(group, state.priceHistory, state.corporateActions, betweenSplits);
    expect(lastShareChange).toBe("2026-11-02");
    expect(points.map(({ date, price }) => [date, price])).toEqual([
      ["2026-10-29", 50], ["2026-10-30", 50], ["2026-11-06", 52],
    ]);

    const beforeSplit = "2026-10-30";
    const [earlier] = groupHoldings(history.snapshotOn(beforeSplit));
    expect(buildInstrumentPriceHistory(earlier, state.priceHistory, state.corporateActions, beforeSplit)).toEqual({
      points: [{ date: "2026-10-30", price: 100, source: "api" }],
      lastShareChange: undefined,
    });
  });

  it("keeps verified share changes after the lot that recorded them is sold", () => {
    const state = splitPortfolio();
    const { id, quantity } = state.holdings[0];
    const sold = sellHolding(state, { id, quantity, sellDate: "2026-11-20", sellPrice: 26 });
    const [group] = groupHoldings(sold.holdings);
    expect(group.lots).toHaveLength(1);
    const { points } = buildInstrumentPriceHistory(group, sold.priceHistory, sold.corporateActions, "2026-11-25");
    expect(points.map(({ date, price }) => [date, price])).toEqual([
      ["2026-10-29", 25], ["2026-11-06", 26], ["2026-11-13", 26],
    ]);
  });
});
