import { describe, expect, it } from "vitest";
import { buildPortfolioTimelineBetween } from "@/lib/portfolio/portfolio-timeline";
import { buildDashboardHistoryDates, buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { addLoan } from "@/lib/storage/loan-store";
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
  it("offers dates with recorded loan activity even when there is no asset price that day", () => {
    const state = addLoan(startingPortfolio(), {
      name: "測試房貸", loanType: "mortgage", purpose: "property", investmentUsePercent: 0,
      openingBalance: 900_000, trackingStartDate: "2026-11-01", firstPaymentDate: "2026-11-04",
      annualInterestRate: 2, rateType: "floating", repaymentMethod: "equal_principal",
      remainingTermMonths: 60, dataQuality: "complete",
    });
    const loan = {
      ...state.loans[0], status: "paid_off" as const, closedAt: "2026-11-20",
      balanceHistory: [
        { effectiveDate: "2026-11-08", balance: 800_000, recordedAt: "2026-11-08T12:00:00Z" },
        { effectiveDate: "2026-11-23", balance: 700_000, recordedAt: "2026-11-23T12:00:00Z" },
      ],
      rateHistory: [{ id: "rate", effectiveDate: "2026-11-12", annualInterestRate: 2.1, createdAt: "2026-11-12T12:00:00Z" }],
      paymentHistory: [{ id: "receipt", paymentDate: "2026-11-16", principalPaid: 10_000,
        interestPaid: 100, feePaid: 0, subsidyReceived: 0, createdAt: "2026-11-16T12:00:00Z" }],
    };
    const assetDates = buildPortfolioHistory(state).dates;

    expect(buildDashboardHistoryDates(assetDates, [loan], "2026-11-30")).toEqual([
      "2026-11-01", "2026-11-02", "2026-11-08", "2026-11-12", "2026-11-16", "2026-11-20",
    ]);
    expect(buildDashboardHistoryDates([], [loan], "2026-11-10")).toEqual(["2026-11-01", "2026-11-08"]);
    expect(buildDashboardHistoryDates([], [{ ...loan, closedAt: undefined }], "2026-11-30"))
      .toEqual(["2026-11-01", "2026-11-16"]);
    expect(assetDates).toEqual(["2026-11-02"]);
  });

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
