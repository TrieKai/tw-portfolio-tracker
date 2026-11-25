import { describe, expect, it } from "vitest";
import { addHolding, applyPriceUpdate, sellHolding } from "@/lib/storage/portfolio-store";
import { addLoan, setLoanStatus } from "@/lib/storage/loan-store";
import { mergePortfolioStorage } from "@/lib/storage/portfolio-export";
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
});
