import { describe, expect, it } from "vitest";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { addHolding, applyPriceUpdate, sellHolding } from "@/lib/storage/portfolio-store";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
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
    loans: [],
    loanRevisions: [],
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
  it("keeps gross pnl and subtracts investment financing costs on request", () => {
    const storage = portfolioWithOneHolding();
    storage.loans.push({
      id: "loan-1",
      name: "投資信貸",
      loanType: "personal_credit",
      purpose: "investment",
      investmentUsePercent: 100,
      openingBalance: 1_000_000,
      trackingStartDate: "2026-06-01",
      annualInterestRate: 3.65,
      rateType: "fixed",
      repaymentMethod: "revolving",
      status: "active",
      dataQuality: "complete",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-10",
      filter: { kind: "investment" },
      includeFinancingCosts: true,
    });

    expect(calendar.summary.grossPnl).toBe(50);
    expect(calendar.summary.financingCost).toBeCloseTo(900, 6);
    expect(calendar.summary.pnl).toBeCloseTo(-850, 6);
  });
  it("subtracts interest from the return of a flat valuation day, including a persisted summary", () => {
    const storage = portfolioWithOneHolding();
    storage.priceHistory["holding-1"][1].price = 100;
    storage.loans.push({
      id: "loan-1", name: "投資信貸", loanType: "personal_credit", purpose: "investment",
      investmentUsePercent: 100, openingBalance: 100_000, trackingStartDate: "2026-06-09",
      annualInterestRate: 3.65, rateType: "fixed", repaymentMethod: "revolving",
      status: "active", dataQuality: "estimated",
      createdAt: "2026-06-09T00:00:00.000Z", updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const options = { month: "2026-06", asOfDate: "2026-06-10", filter: { kind: "investment" as const } };
    const gross = buildPnlCalendar(storage, options).days[0];
    expect(gross).toMatchObject({ pnl: 0, returnRate: 0, returnBase: 1000 });

    const net = buildPnlCalendar(storage, { ...options, includeFinancingCosts: true }).days[0];
    expect(net).toMatchObject({ grossPnl: 0, pnl: -10, returnRate: -1 });

    storage.priceHistory = {};
    storage.pnlTracking.dailySummaries[gross.date] = {
      date: gross.date, pnl: gross.pnl, returnRate: gross.returnRate, returnBase: gross.returnBase,
      computedAt: gross.date, quality: gross.quality,
    };
    expect(buildPnlCalendar(storage, { ...options, includeFinancingCosts: true }).days[0].returnRate).toBe(-1);
    delete storage.pnlTracking.dailySummaries[gross.date].returnBase;
    expect(buildPnlCalendar(storage, { ...options, includeFinancingCosts: true }).days[0].returnRate).toBeNull();
  });

  it("labels a multi-session price move as an interval and ignores intervening weekends", () => {
    const storage = portfolioWithOneHolding();
    storage.pnlTracking.startedAt = "2026-06-01";
    storage.priceHistory["holding-1"] = [
      { date: "2026-06-05", price: 100, source: "api" },
      { date: "2026-06-08", price: 105, source: "api" },
      { date: "2026-06-10", price: 110, source: "api" },
    ];
    const { days } = buildPnlCalendar(storage, {
      month: "2026-06", asOfDate: "2026-06-30", filter: { kind: "investment" },
    });

    expect(days[0]).toMatchObject({ date: "2026-06-08", pnl: 50, quality: "complete" });
    expect(days[0].gapStartDate).toBeUndefined();
    expect(days[1]).toMatchObject({ date: "2026-06-10", pnl: 50, quality: "estimated", gapStartDate: "2026-06-08" });
    expect(days[1].contributions[0].gapStartDate).toBe("2026-06-08");
  });

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

  it("uses the purchase price when historical quotes predate a holding without a buy transaction", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings[0] = {
      ...storage.holdings[0],
      buyDate: "2026-06-10",
    };
    storage.priceHistory["holding-1"] = [
      { date: "2026-06-09", price: 80, source: "api" },
      { date: "2026-06-10", price: 100, source: "api" },
      { date: "2026-06-11", price: 105, source: "api" },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((day) => day.date === "2026-06-10")).toMatchObject({
      pnl: 100,
      returnRate: 100 / 9,
      contributions: [{ previousPrice: 90, currentPrice: 100, pnl: 100 }],
    });
    expect(calendar.days.find((day) => day.date === "2026-06-11")?.pnl).toBe(50);
    expect(calendar.summary.pnl).toBe(150);
  });

  it("uses the purchase price when the first quote arrives after the purchase date", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings[0] = {
      ...storage.holdings[0],
      buyDate: "2026-06-10",
    };
    storage.priceHistory["holding-1"] = [
      { date: "2026-06-09", price: 80, source: "api" },
      { date: "2026-06-11", price: 105, source: "api" },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });

    expect(calendar.days.find((day) => day.date === "2026-06-11")?.pnl).toBe(150);
  });

  it("merges multiple holdings of the same asset into one daily detail", () => {
    const storage = portfolioWithOneHolding();
    storage.holdings.push({
      ...storage.holdings[0],
      id: "holding-2",
      quantity: 20,
    });
    storage.priceHistory["holding-2"] = [
      { date: "2026-06-09", price: 98, source: "api" },
      { date: "2026-06-10", price: 106, source: "api" },
    ];

    const calendar = buildPnlCalendar(storage, {
      month: "2026-06",
      asOfDate: "2026-06-30",
      filter: { kind: "investment" },
    });
    const contributions = calendar.days.find(
      (item) => item.date === "2026-06-10"
    )?.contributions;

    expect(contributions).toHaveLength(1);
    expect(contributions?.[0]).toMatchObject({
      holdingIds: ["holding-1", "holding-2"],
      name: "測試股票",
      symbol: "2330",
      assetType: "stock",
      pnl: 210,
      marketPnl: 210,
      previousPrice: 98.666666666667,
      currentPrice: 105.666666666667,
    });
  });

  it("attributes only the sell-day move and costs for a closed position", () => {
    const calendar = buildPnlCalendar(
      {
        version: 2,
        holdings: [],
        loans: [],
        loanRevisions: [],
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

  it("shows the realized sale with missing reference prices and omits a daily rate", () => {
    const bought = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試股票", symbol: "2330", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const id = bought.holdings[0].id;
    const sold = sellHolding(bought, { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-06", fee: 20, tax: 30 });
    const options = { month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" as const } };
    const older = {
      ...sold,
      transactions: [],
      pnlTracking: { startedAt: "", dailySummaries: {} },
    };
    for (const state of [sold, older]) {
      const calendar = buildPnlCalendar(state, options);
      expect(calendar.summary).toMatchObject({ pnl: 1950, gainDayCount: 0, returnRate: null });
      expect(calendar.days[0]).toMatchObject({
        date: "2026-11-06", pnl: 1950, saleWithoutPriorPrice: true, returnRate: null, quality: "estimated",
        contributions: [{ tradePnl: 2000, fee: 20, tax: 30, saleWithoutPriorPrice: true }],
      });
    }
  });

  it("attributes only the sale-day movement after a valid preceding quote is available", () => {
    const bought = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試股票", symbol: "2330", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const id = bought.holdings[0].id;
    const quoted = applyPriceUpdate(bought, id, 115, "2026-11-05", "manual");
    const sold = sellHolding(quoted, { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-06", fee: 20 });
    const calendar = buildPnlCalendar(sold, {
      month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
    });
    expect(calendar.days.find((day) => day.date === "2026-11-06")).toMatchObject({ pnl: 480 });
    expect(calendar.days.find((day) => day.date === "2026-11-06")?.saleWithoutPriorPrice).toBeUndefined();
  });


  it("adds the purchase-to-first-quote interval and reconciles to the same-month sale", () => {
    const held = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試股票", symbol: "2330", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const id = held.holdings[0].id;
    const quoted = applyPriceUpdate(held, id, 115, "2026-11-05", "manual");
    const sold = sellHolding(quoted, { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-06" });
    const calendar = buildPnlCalendar(sold, {
      month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
    });

    expect(calendar.days).toMatchObject([
      { date: "2026-11-05", gapStartDate: "2026-11-02", pnl: 1500, quality: "estimated" },
      { date: "2026-11-06", pnl: 500, quality: "complete" },
    ]);
    expect(calendar.summary.pnl).toBe(sold.sales[0].realizedPnl);
    expect(calendar.summary.gainDayCount).toBe(1);
  });

  it("does not attribute the first quote to units already sold without a previous close", () => {
    const held = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試股票", symbol: "2330", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100, fee: 25,
    });
    const id = held.holdings[0].id;
    const sold = sellHolding(held, { id, quantity: 40, sellPrice: 110, sellDate: "2026-11-04" });
    const quoted = applyPriceUpdate(sold, id, 115, "2026-11-05", "manual");
    const calendar = buildPnlCalendar(quoted, {
      month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
    });

    expect(calendar.days).toMatchObject([
      { date: "2026-11-02", pnl: -25, returnRate: null },
      { date: "2026-11-04", pnl: 400, saleWithoutPriorPrice: true },
      { date: "2026-11-05", pnl: 900, gapStartDate: "2026-11-02" },
    ]);
    expect(calendar.summary.pnl).toBe(1275);
  });


  it("cannot treat the oldest retained quote as the initial valuation of a pre-retention purchase", () => {
    const state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試股票", symbol: "2330", quantity: 100,
      buyDate: "2018-01-02", buyPrice: 100,
    });
    state.priceHistory[state.holdings[0].id] = [
      { date: "2026-11-05", price: 130, source: "manual" },
      { date: "2026-11-06", price: 131, source: "manual" },
    ];
    const calendar = buildPnlCalendar(state, {
      month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
    });
    expect(calendar.days.map(({ date, pnl }) => [date, pnl])).toEqual([["2026-11-06", 100]]);
  });

});
