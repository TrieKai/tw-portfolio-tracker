import { describe, expect, it } from "vitest";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import type { PortfolioStorage } from "@/lib/types/holding";

function portfolioWithOneHolding(): PortfolioStorage {
  return {
    version: 2,
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
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    priceHistory: {
      "holding-1": [
        { date: "2026-06-09", price: 100, source: "api" },
        { date: "2026-06-10", price: 105, source: "api" },
      ],
    },
    sales: [],
    corporateActions: [],
    transactions: [],
    transactionRevisions: [],
    pnlTracking: { startedAt: "", dailySummaries: {} },
    settings: { autoUpdateEnabled: false },
  };
}

describe("buildPnlCalendar", () => {
  it("calculates a held position's close-to-close daily return", () => {
    const calendar = buildPnlCalendar(portfolioWithOneHolding(), {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });

    const day = calendar.days.find((item) => item.date === "2026-06-10");

    expect(day).toMatchObject({
      pnl: 50,
      returnRate: 5,
      pricedHoldingCount: 1,
      totalHoldingCount: 1,
    });
  });

  it("attributes only the sell-day move and costs for a closed position", () => {
    const calendar = buildPnlCalendar(
      {
        version: 2,
        holdings: [],
        priceHistory: {
          "holding-1": [
            { date: "2026-08-18", price: 108, source: "api" },
          ],
        },
        sales: [],
        corporateActions: [],
        transactions: [
          {
            id: "buy-1",
            type: "buy",
            holdingId: "holding-1",
            assetType: "stock",
            name: "測試股票",
            symbol: "2330",
            market: "tse",
            date: "2026-08-01",
            quantity: 10,
            price: 100,
            fee: 0,
            tax: 0,
            quality: "complete",
            source: "user",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "sell-1",
            type: "sell",
            holdingId: "holding-1",
            assetType: "stock",
            name: "測試股票",
            symbol: "2330",
            market: "tse",
            date: "2026-08-19",
            quantity: 10,
            price: 110,
            fee: 5,
            tax: 3,
            quality: "complete",
            source: "user",
            createdAt: "2026-08-19T00:00:00.000Z",
            updatedAt: "2026-08-19T00:00:00.000Z",
          },
        ],
        transactionRevisions: [],
        pnlTracking: { startedAt: "2026-08-01", dailySummaries: {} },
        settings: { autoUpdateEnabled: false },
      },
      {
        month: "2026-08",
        asOfDate: "2026-08-31",
        filter: { kind: "investment" },
      }
    );

    expect(calendar.days.find((item) => item.date === "2026-08-19")).toMatchObject({
      pnl: 12,
      returnRate: (12 / 1_080) * 100,
      pricedHoldingCount: 1,
      totalHoldingCount: 1,
    });
  });

  it("uses the trade price and fee for a position bought during the day", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings[0] = {
      ...storage.holdings[0],
      buyPrice: 100,
      buyDate: "2026-06-10",
    };
    storage.priceHistory["holding-1"] = [
      { date: "2026-06-09", price: 90, source: "api" },
      { date: "2026-06-10", price: 105, source: "api" },
    ];
    storage.transactions = [
      {
        id: "buy-1",
        type: "buy",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-06-10",
        quantity: 10,
        price: 100,
        fee: 5,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
      },
    ];
    storage.pnlTracking.startedAt = "2026-06-10";

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-06-10")).toMatchObject({
      pnl: 45,
      returnRate: 4.5,
      pricedHoldingCount: 1,
      totalHoldingCount: 1,
    });
  });

  it("reconstructs the quantity before a later partial sale", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings[0] = { ...storage.holdings[0], quantity: 6 };
    storage.priceHistory["holding-1"] = [
      { date: "2026-08-17", price: 100, source: "api" },
      { date: "2026-08-18", price: 105, source: "api" },
      { date: "2026-08-19", price: 110, source: "api" },
    ];
    storage.transactions = [
      {
        id: "buy-1",
        type: "buy",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-06-01",
        quantity: 10,
        price: 90,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "sell-1",
        type: "sell",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-08-19",
        quantity: 4,
        price: 112,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ];
    storage.pnlTracking.startedAt = "2026-06-01";

    const calendar = buildPnlCalendar(storage, {
      month: "2026-08",
      asOfDate: "2026-08-31",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-08-18")).toMatchObject({
      pnl: 50,
      returnRate: 5,
    });
  });

  it("keeps calculating days before a fully closed position", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings = [];
    storage.priceHistory["holding-1"] = [
      { date: "2026-08-17", price: 100, source: "api" },
      { date: "2026-08-18", price: 105, source: "api" },
    ];
    storage.transactions = [
      {
        id: "buy-1",
        type: "buy",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-06-01",
        quantity: 10,
        price: 90,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "sell-1",
        type: "sell",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-08-19",
        quantity: 10,
        price: 110,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-08",
      asOfDate: "2026-08-31",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-08-18")).toMatchObject({
      pnl: 50,
      returnRate: 5,
      totalHoldingCount: 1,
    });
  });

  it("includes cash dividends on the ex-dividend date", () => {
    const storage = portfolioWithOneHolding();
    storage.priceHistory["holding-1"] = [
      { date: "2026-08-18", price: 105, source: "api" },
      { date: "2026-08-19", price: 100, source: "api" },
    ];
    storage.transactions = [
      {
        id: "dividend-1",
        type: "cash_dividend",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-08-19",
        amount: 50,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "corporate_action",
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-08",
      asOfDate: "2026-08-31",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-08-19")).toMatchObject({
      pnl: 0,
      returnRate: 0,
    });
  });

  it("marks a day partial when only some active holdings have a new price", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings.push({
      id: "holding-2",
      assetType: "fund",
      name: "測試基金",
      symbol: "1234",
      buyPrice: 10,
      quantity: 100,
      buyDate: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    storage.priceHistory = {
      "holding-1": [
        { date: "2026-08-18", price: 100, source: "api" },
        { date: "2026-08-19", price: 105, source: "api" },
      ],
      "holding-2": [
        { date: "2026-08-18", price: 12, source: "api" },
      ],
    };
    storage.pnlTracking.startedAt = "2026-08-01";

    const calendar = buildPnlCalendar(storage, {
      month: "2026-08",
      asOfDate: "2026-08-31",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-08-19")).toMatchObject({
      pnl: 50,
      pricedHoldingCount: 1,
      totalHoldingCount: 2,
      coverageRate: 50,
      quality: "partial",
    });
  });

  it("compounds daily returns for weekly and monthly summaries", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings[0] = { ...storage.holdings[0], quantity: 1 };
    storage.priceHistory["holding-1"] = [
      { date: "2026-06-08", price: 100, source: "api" },
      { date: "2026-06-09", price: 110, source: "api" },
      { date: "2026-06-10", price: 99, source: "api" },
    ];
    storage.pnlTracking.startedAt = "2026-06-01";

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });

    expect(calendar).toMatchObject({
      summary: {
        pnl: -1,
        returnRate: -1,
        gainDayCount: 1,
        lossDayCount: 1,
        dataDayCount: 2,
      },
      weeks: [
        {
          startDate: "2026-06-08",
          endDate: "2026-06-12",
          pnl: -1,
          returnRate: -1,
        },
      ],
    });
  });

  it("returns per-holding price, dividend, fee and tax contributions", () => {
    const storage = portfolioWithOneHolding();
    storage.priceHistory["holding-1"] = [
      { date: "2026-08-18", price: 105, source: "api" },
      { date: "2026-08-19", price: 100, source: "api" },
    ];
    storage.transactions = [
      {
        id: "dividend-1",
        type: "cash_dividend",
        holdingId: "holding-1",
        assetType: "stock",
        name: "測試股票",
        symbol: "2330",
        market: "tse",
        date: "2026-08-19",
        amount: 50,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "corporate_action",
        createdAt: "2026-08-19T00:00:00.000Z",
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-08",
      asOfDate: "2026-08-31",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((item) => item.date === "2026-08-19")?.contributions).toMatchObject([
      {
        holdingId: "holding-1",
        name: "測試股票",
        symbol: "2330",
        assetType: "stock",
        pnl: 0,
        marketPnl: -50,
        tradePnl: 0,
        dividend: 50,
        fee: 0,
        tax: 0,
      },
    ]);
  });

  it("shows a permanently stored total after per-holding detail expires", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings = [];
    storage.priceHistory = {};
    storage.pnlTracking = {
      startedAt: "2023-01-01",
      dailySummaries: {
        "2023-06-12": {
          date: "2023-06-12",
          pnl: 1_200,
          returnRate: 1.2,
          quality: "complete",
          computedAt: "2023-06-12T10:00:00.000Z",
        },
      },
    };

    const calendar = buildPnlCalendar(storage, {
      month: "2023-06",
      asOfDate: "2026-08-19",
      filter: { kind: "investment" },
    });

    expect(calendar.days).toMatchObject([
      {
        date: "2023-06-12",
        pnl: 1_200,
        returnRate: 1.2,
        quality: "complete",
        contributions: [],
      },
    ]);
  });
});
