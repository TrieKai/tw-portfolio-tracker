import { describe, expect, it } from "vitest";
import { addHolding, applyManualCorporateAction, applyPriceUpdate, editHolding, sellHolding } from "@/lib/storage/portfolio-store";
import { addLoan, setLoanStatus } from "@/lib/storage/loan-store";
import { mergePortfolioStorage } from "@/lib/storage/portfolio-export";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";

function savedPortfolio() {
  const opened = addHolding(defaultPortfolioStorage(), {
    assetType: "stock", name: "台積電", symbol: "2330", quantity: 100,
    buyPrice: 100, buyDate: "2026-11-02",
  });
  return addLoan(opened, {
    name: "投資信用貸款", loanType: "personal_credit", purpose: "investment",
    investmentUsePercent: 100, openingBalance: 100_000, annualInterestRate: 3,
    repaymentMethod: "revolving", rateType: "fixed", trackingStartDate: "2026-11-02",
    dataQuality: "estimated",
  }, "2026-11-02T00:00:00.000Z");
}

describe("backup merging", () => {
  it("preserves newer records, preferences and the existing quote on a conflicting date", () => {
    const older = savedPortfolio();
    const id = older.holdings[0].id;
    older.holdings[0].updatedAt = "2026-11-02T00:00:00.000Z";
    const quoted = applyPriceUpdate(older, id, 108, "2026-11-03", "manual");
    const current = setLoanStatus(quoted, quoted.loans[0].id, "paid_off", "2026-11-06", "2026-11-06T00:00:00.000Z");
    current.settings = { ...current.settings, autoUpdateEnabled: true };
    older.priceHistory[id] = [
      { date: "2026-11-02", price: 104, source: "api" },
      { date: "2026-11-03", price: 101, source: "api" },
    ];
    const merged = mergePortfolioStorage(current, older);

    expect(merged.holdings[0].currentPrice).toBe(108);
    expect(merged.loans[0].status).toBe("paid_off");
    expect(merged.settings.autoUpdateEnabled).toBe(true);
    expect(merged.priceHistory[id].map((point) => point.price)).toEqual([104, 108]);
  });

  it("does not restore a holding already sold in full", () => {
    const older = savedPortfolio();
    const sold = sellHolding(older, {
      id: older.holdings[0].id, quantity: 100, sellPrice: 110, sellDate: "2026-11-06",
    });
    const merged = mergePortfolioStorage(sold, older);

    expect(merged.holdings).toEqual([]);
    expect(merged.sales).toEqual(sold.sales);
  });

  it("reconciles an older open position with a backup that has sold it completely", () => {
    const opened = savedPortfolio();
    const id = opened.holdings[0].id;
    const sold = sellHolding(opened, { id, quantity: 100, sellPrice: 110, sellDate: "2026-11-06" });
    const legacy = { ...sold, sales: sold.sales.map((sale) => ({ ...sale, positionClosed: undefined })) };

    for (const backup of [sold, legacy]) {
      const merged = mergePortfolioStorage(opened, backup);
      expect(merged.holdings).toEqual([]);
      expect(merged.sales).toHaveLength(1);
      expect(buildPortfolioHistory(merged).snapshotOn("2026-11-03")[0]?.quantity).toBe(100);
    }
  });

  it("applies independent partial sales once, even after repeat imports", () => {
    const opened = savedPortfolio();
    const id = opened.holdings[0].id;
    const local = sellHolding(opened, { id, quantity: 20, sellPrice: 110, sellDate: "2026-11-06" });
    const backup = sellHolding(opened, { id, quantity: 30, sellPrice: 115, sellDate: "2026-11-09" });

    const merged = mergePortfolioStorage(local, backup);
    const importedAgain = mergePortfolioStorage(merged, backup);
    expect(merged.holdings[0].quantity).toBe(50);
    expect(importedAgain.holdings[0].quantity).toBe(50);
    expect(importedAgain.sales).toHaveLength(2);
  });

  it("converts prices from both sides of a stock split to the same share basis", () => {
    const opened = savedPortfolio();
    const id = opened.holdings[0].id;
    const oldPrice = applyPriceUpdate(opened, id, 100, "2026-11-02", "manual");
    oldPrice.holdings[0].updatedAt = "2026-11-03T00:00:00.000Z";
    const beforeSplit = applyPriceUpdate(opened, id, 100, "2026-11-03", "manual");
    const split = applyManualCorporateAction(beforeSplit, {
      holdingId: id, effectiveDate: "2026-11-04", actionType: "split", adjustmentRatio: 2,
    });
    const afterSplit = applyPriceUpdate(split, id, 50, "2026-11-05", "manual");

    for (const merged of [mergePortfolioStorage(afterSplit, oldPrice), mergePortfolioStorage(oldPrice, afterSplit)]) {
      expect(merged.holdings[0]).toMatchObject({ quantity: 200, buyPrice: 50, currentPrice: 50 });
      expect(merged.priceHistory[id].map((point) => point.price)).toEqual([50, 50, 50]);
      const calendar = buildPnlCalendar(merged, {
        month: "2026-11", asOfDate: "2026-11-06", filter: { kind: "investment" },
      });
      expect(calendar.days.find((day) => day.date === "2026-11-03")?.pnl).toBe(0);
    }
  });

  it("does not import price history for the previous symbol after an instrument correction", () => {
    const opened = savedPortfolio();
    const id = opened.holdings[0].id;
    const original = applyPriceUpdate(opened, id, 108, "2026-11-03", "manual");
    original.holdings[0].updatedAt = "2026-11-04T00:00:00.000Z";
    const corrected = editHolding(original, { ...original.holdings[0], symbol: "2317", name: "鴻海" });
    const merged = mergePortfolioStorage(corrected, original);

    expect(merged.holdings[0].symbol).toBe("2317");
    expect(merged.priceHistory[id]).toBeUndefined();
  });

});
