import { describe, expect, it } from "vitest";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import {
  addCashDividend,
  addHolding,
  applyCorporateAction,
  applyManualCorporateAction,
  applyPriceUpdate,
  editHolding,
  sellHolding,
} from "@/lib/storage/portfolio-store";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";

describe("portfolio transaction tracking", () => {
  it("records a new investment holding as a buy transaction", () => {
    const next = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "台積電",
      symbol: "2330",
      market: "tse",
      buyPrice: 1_000,
      quantity: 10,
      buyDate: "2026-08-19",
      fee: 15,
    });
    const holdingId = next.holdings[0]?.id;

    expect(next).toMatchObject({
      transactions: [
        {
          type: "buy",
          holdingId,
          date: "2026-08-19",
          quantity: 10,
          price: 1_000,
          fee: 15,
          tax: 0,
          quality: "complete",
          source: "user",
        },
      ],
      pnlTracking: { startedAt: "2026-08-19" },
    });
  });

  it("keeps valuation history and records net proceeds when a position is closed", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 10,
      buyDate: "2026-08-01",
    });
    const holdingId = added.holdings[0].id;
    const withHistory = {
      ...added,
      priceHistory: {
        [holdingId]: [
          { date: "2026-08-18", price: 108, source: "api" as const },
        ],
      },
    };

    const sold = sellHolding(withHistory, {
      id: holdingId,
      quantity: 10,
      sellPrice: 110,
      sellDate: "2026-08-19",
      fee: 5,
      tax: 3,
    });

    expect(sold).toMatchObject({
      holdings: [],
      priceHistory: withHistory.priceHistory,
      sales: [{ fee: 5, tax: 3, realizedPnl: 92 }],
      transactions: [
        { type: "buy" },
        {
          type: "sell",
          holdingId,
          date: "2026-08-19",
          quantity: 10,
          price: 110,
          fee: 5,
          tax: 3,
          quality: "complete",
        },
      ],
    });
  });

  it("records a cash dividend once on the ex-dividend date", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 10,
      buyDate: "2026-01-01",
    });
    const holdingId = added.holdings[0].id;
    const event = {
      id: "dividend-2026",
      holdingId,
      symbol: "2330",
      market: "tse" as const,
      name: "測試股票",
      type: "cash_dividend" as const,
      effectiveDate: "2026-08-19",
      source: "twse" as const,
      exDividendLabel: "除息",
      stockDividendRatio: 0,
      subscriptionRatio: 0,
      cashDividend: 5,
      autoApplicable: true,
    };

    const applied = applyCorporateAction(added, event);
    const appliedAgain = applyCorporateAction(applied, event);

    expect(appliedAgain.transactions).toMatchObject([
      { type: "buy" },
      {
        type: "cash_dividend",
        holdingId,
        date: "2026-08-19",
        amount: 50,
        source: "corporate_action",
      },
    ]);
  });

  it("records a manually entered fund distribution", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "fund",
      name: "測試基金",
      symbol: "1234",
      buyPrice: 10,
      quantity: 100,
      buyDate: "2026-01-01",
    });
    const holdingId = added.holdings[0].id;

    const next = addCashDividend(added, {
      holdingId,
      effectiveDate: "2026-08-19",
      settlementDate: "2026-09-01",
      amount: 80,
      note: "基金配息",
    });

    expect(next.transactions.at(-1)).toMatchObject({
      type: "cash_dividend",
      holdingId,
      date: "2026-08-19",
      settlementDate: "2026-09-01",
      amount: 80,
      source: "user",
    });
  });

  it("audits a correction to the original buy transaction", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "fund",
      name: "測試基金",
      symbol: "1234",
      buyPrice: 10,
      quantity: 100,
      buyDate: "2026-01-01",
    });
    const holdingId = added.holdings[0].id;
    const buyTransaction = added.transactions[0];

    const corrected = editHolding(added, {
      id: holdingId,
      assetType: "fund",
      name: "測試基金",
      symbol: "1234",
      buyPrice: 11,
      quantity: 120,
      buyDate: "2026-01-02",
    });

    expect(corrected).toMatchObject({
      transactions: [
        {
          id: buyTransaction.id,
          type: "buy",
          date: "2026-01-02",
          price: 11,
          quantity: 120,
        },
      ],
      transactionRevisions: [
        {
          transactionId: buyTransaction.id,
          previous: {
            date: "2026-01-01",
            price: 10,
            quantity: 100,
          },
        },
      ],
    });
  });

  it("treats an edited post-sale quantity as the corrected remaining balance", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 10,
      buyDate: "2026-01-01",
    });
    const holdingId = added.holdings[0].id;
    const partiallySold = sellHolding(added, {
      id: holdingId,
      quantity: 4,
      sellPrice: 110,
      sellDate: "2026-08-18",
    });

    const corrected = editHolding(partiallySold, {
      id: holdingId,
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 7,
      buyDate: "2026-01-01",
    });

    expect(corrected.transactions[0]).toMatchObject({
      type: "buy",
      quantity: 11,
    });
    expect(corrected.holdings[0].quantity).toBe(7);
  });

  it("persists a daily total after a new valuation is saved", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 90,
      quantity: 10,
      buyDate: "2026-08-01",
    });
    const holdingId = added.holdings[0].id;
    const first = applyPriceUpdate(added, holdingId, 100, "2026-08-18", "api");

    const second = applyPriceUpdate(first, holdingId, 105, "2026-08-19", "api");

    expect(second.pnlTracking.dailySummaries["2026-08-19"]).toMatchObject({
      date: "2026-08-19",
      pnl: 50,
      returnRate: 5,
      quality: "complete",
    });
  });

  it("rebases pre-split ledger units so adjusted prices keep the correct daily pnl", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 10,
      buyDate: "2026-08-01",
    });
    const holdingId = added.holdings[0].id;
    const withHistory = {
      ...added,
      priceHistory: {
        [holdingId]: [
          { date: "2026-08-18", price: 100, source: "api" as const },
          { date: "2026-08-19", price: 55, source: "api" as const },
        ],
      },
    };

    const applied = applyCorporateAction(withHistory, {
      id: "split-2026",
      holdingId,
      symbol: "2330",
      market: "tse",
      name: "測試股票",
      type: "stock_dividend",
      effectiveDate: "2026-08-19",
      source: "twse",
      exDividendLabel: "除權",
      stockDividendRatio: 1,
      subscriptionRatio: 0,
      autoApplicable: true,
    });
    const calendar = buildPnlCalendar(applied, {
      month: "2026-08",
      asOfDate: "2026-08-19",
      filter: { kind: "investment" },
    });

    expect(applied.transactions[0]).toMatchObject({
      type: "buy",
      quantity: 20,
      price: 50,
    });
    expect(applied.transactionRevisions).toHaveLength(1);
    expect(calendar.days.find((day) => day.date === "2026-08-19")?.pnl).toBe(
      100
    );
  });

  it("records capital-reduction cash as a capital flow instead of investment pnl", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock",
      name: "測試股票",
      symbol: "2330",
      market: "tse",
      buyPrice: 100,
      quantity: 10,
      buyDate: "2026-08-01",
    });
    const holdingId = added.holdings[0].id;

    const applied = applyManualCorporateAction(added, {
      holdingId,
      actionType: "capital_reduction",
      effectiveDate: "2026-08-19",
      adjustmentRatio: 0.8,
      cashReturnPerShare: 5,
    });
    const calendar = buildPnlCalendar(applied, {
      month: "2026-08",
      asOfDate: "2026-08-19",
      filter: { kind: "investment" },
    });

    expect(applied.transactions.at(-1)).toMatchObject({
      type: "capital_return",
      holdingId,
      date: "2026-08-19",
      amount: 50,
      source: "corporate_action",
    });
    expect(calendar.summary.pnl).toBe(0);
  });
});
