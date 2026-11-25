import { describe, expect, it, vi } from "vitest";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import {
  addCashDividend,
  addHolding,
  applyCorporateAction,
  applyManualCorporateAction,
  applyPriceUpdate,
  editHolding,
  sellHolding,
  sellHoldings,
} from "@/lib/storage/portfolio-store";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { addDaysToIsoDate, todayIsoDate } from "@/lib/date/iso-date";

describe("portfolio transaction tracking", () => {
  it("refreshes saved later valuations after a backdated sale and keeps the corrected total after price expiry", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const initial = addHolding(defaultPortfolioStorage(), {
        assetType: "stock", symbol: "2330", name: "驗證股票", quantity: 100, buyPrice: 100, buyDate: "2022-11-02",
      });
      const id = initial.holdings[0].id;
      const priced = applyPriceUpdate(applyPriceUpdate(initial, id, 110, "2022-11-03", "manual"),
        id, 120, "2022-11-07", "manual");
      expect(priced.pnlTracking.dailySummaries["2022-11-07"].pnl).toBe(1000);
      const sold = sellHolding(priced, { id, quantity: 60, sellPrice: 115, sellDate: "2022-11-04" });
      expect(sold.pnlTracking.dailySummaries["2022-11-03"].pnl).toBe(1000);
      expect(sold.pnlTracking.dailySummaries["2022-11-07"].pnl).toBe(400);
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const expired = applyPriceUpdate(sold, id, 130, "2026-11-25", "manual");
      expect(expired.priceHistory[id].map((point) => point.date)).toEqual(["2026-11-25"]);
      const calendar = buildPnlCalendar(expired, {
        month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
      });
      expect(calendar.days.map(({ date, pnl }) => [date, pnl])).toEqual([
        ["2022-11-03", 1000], ["2022-11-04", 300], ["2022-11-07", 400],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores corrected valuation totals after editing an acquisition and before prices expire", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const initial = addHolding(defaultPortfolioStorage(), {
        assetType: "stock", symbol: "2330", name: "驗證股票", quantity: 100, buyPrice: 100, buyDate: "2022-11-02",
      });
      const id = initial.holdings[0].id;
      const priced = applyPriceUpdate(applyPriceUpdate(initial, id, 110, "2022-11-03", "manual"), id, 120, "2022-11-07", "api");
      const corrected = editHolding(priced, { ...priced.holdings[0], buyPrice: 105, quantity: 80 });
      expect(corrected.pnlTracking.dailySummaries["2022-11-03"]?.pnl).toBe(400);
      expect(corrected.pnlTracking.dailySummaries["2022-11-07"]?.pnl).toBe(800);
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const expired = applyPriceUpdate(corrected, id, 130, "2026-11-25", "api");
      const calendar = buildPnlCalendar(expired, {
        month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
      });
      expect(calendar.summary.pnl).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves holdings and history intact until a company action takes effect", () => {
    const opened = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "驗證股票", quantity: 100, buyPrice: 100, buyDate: "2020-01-02",
    });
    const holdingId = opened.holdings[0].id;
    const today = todayIsoDate();
    const future = addDaysToIsoDate(today, 1);
    const event = {
      id: "future-stock-dividend", holdingId, symbol: "2330", market: "tse" as const, name: "驗證股票",
      type: "stock_dividend" as const, effectiveDate: future, source: "twse" as const, exDividendLabel: "除權",
      stockDividendRatio: 0.1, subscriptionRatio: 0, autoApplicable: true,
    };
    const manual = { holdingId, effectiveDate: future, actionType: "split" as const, adjustmentRatio: 2 };
    expect(applyCorporateAction(opened, event)).toBe(opened);
    expect(applyManualCorporateAction(opened, manual)).toBe(opened);
    expect(applyManualCorporateAction(opened, { ...manual, effectiveDate: "2020-02-30" })).toBe(opened);
    expect(applyCorporateAction(opened, { ...event, effectiveDate: today }).holdings[0].quantity).toBeCloseTo(110);
    expect(applyManualCorporateAction(opened, { ...manual, effectiveDate: today }).holdings[0].quantity).toBe(200);
  });

  it("turns a property mortgage balance into a loan record", () => {
    const next = addHolding(defaultPortfolioStorage(), {
      assetType: "property",
      name: "自住房",
      symbol: "HOME",
      buyPrice: 10_000_000,
      quantity: 1,
      buyDate: "2020-01-01",
      mortgageBalance: 6_000_000,
    });

    expect(next.holdings[0].mortgageBalance).toBeUndefined();
    expect(next.loans[0]).toMatchObject({
      name: "自住房 房貸",
      loanType: "mortgage",
      purpose: "property",
      openingBalance: 6_000_000,
      linkedHoldingId: next.holdings[0].id,
      dataQuality: "incomplete",
    });
  });
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

  it("clears only the corrected instrument's prices while retaining same-symbol price history", () => {
    const added = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "台積電", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const id = added.holdings[0].id;
    const quoted = applyPriceUpdate(added, id, 150, "2026-11-03", "manual");
    const sameSymbol = editHolding(quoted, { ...quoted.holdings[0], symbol: " 2330 " });
    expect(sameSymbol.holdings[0].currentPrice).toBe(150);
    expect(sameSymbol.priceHistory[id]).toEqual(quoted.priceHistory[id]);

    const corrected = editHolding(quoted, { ...quoted.holdings[0], symbol: "2317", name: "鴻海" });
    expect(corrected.holdings[0]).toMatchObject({ symbol: "2317", currentPrice: undefined, priceDate: undefined });
    expect(corrected.priceHistory[id]).toBeUndefined();
    expect(corrected.transactions[0]).toMatchObject({ symbol: "2317", date: "2026-11-02" });
  });

  it("rejects a sale before acquisition and applies no partial group edit", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "台積電", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    state = addHolding(state, {
      assetType: "stock", symbol: "2330", name: "台積電", quantity: 100,
      buyDate: "2026-11-06", buyPrice: 100,
    });
    const [first, second] = state.holdings;
    const sale = { id: first.id, quantity: 40, sellPrice: 110, sellDate: "2026-11-04" };

    expect(sellHolding(state, { ...sale, id: second.id })).toBe(state);
    expect(sellHolding(state, { ...sale, sellDate: "2026-11-31" })).toBe(state);
    expect(sellHoldings(state, [sale, { ...sale, id: second.id }])).toBe(state);
    expect(sellHolding(state, { ...sale, sellDate: first.buyDate }).sales).toHaveLength(1);
  });


  it("records a backdated sale in the units and cost of the execution day", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "測試股票", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const id = state.holdings[0].id;
    state = applyPriceUpdate(state, id, 100, "2026-11-05", "manual");
    state = applyManualCorporateAction(state, {
      holdingId: id, effectiveDate: "2026-11-10", actionType: "split", adjustmentRatio: 2,
    });
    const sale = { id, sellDate: "2026-11-06", quantity: 30, sellPrice: 110 };
    expect(sellHolding(state, { ...sale, quantity: 101 })).toBe(state);
    const remaining = sellHolding(state, sale);

    expect(remaining.holdings[0].quantity).toBe(140);
    expect(remaining.sales[0]).toMatchObject({ quantity: 30, buyPrice: 100, sellPrice: 110, realizedPnl: 300 });
    expect(remaining.transactions.find((event) => event.type === "sell")).toMatchObject({ quantity: 60, price: 55 });
    const history = buildPortfolioHistory(remaining);
    expect(history.snapshotOn("2026-11-05")[0]?.quantity).toBe(100);
    expect(history.snapshotOn("2026-11-06")[0]?.quantity).toBe(70);
    expect(history.snapshotOn("2026-11-10")[0]?.quantity).toBe(140);
    const calendar = buildPnlCalendar(remaining, {
      month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
    });
    expect(calendar.days.find((day) => day.date === "2026-11-06")?.pnl).toBe(300);

    const corrected = editHolding(remaining, { ...remaining.holdings[0], buyPrice: 55 });
    expect(corrected.sales[0]).toMatchObject({ buyPrice: 110, realizedPnl: 0 });
    expect(buildPortfolioHistory(corrected).snapshotOn("2026-11-05")[0]?.buyPrice).toBe(110);
  });

  it("reprices earlier sales after a purchase-cost correction while preserving execution and fees", () => {
    const initial = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "測試股票", quantity: 100,
      buyDate: "2026-11-02", buyPrice: 100,
    });
    const sold = sellHolding(initial, {
      id: initial.holdings[0].id, sellDate: "2026-11-06", quantity: 40, sellPrice: 120, fee: 5, tax: 3,
    });
    const updated = editHolding(sold, { ...sold.holdings[0], buyPrice: 110 });
    expect(updated.sales[0]).toMatchObject({
      id: sold.sales[0].id, sellDate: "2026-11-06", quantity: 40, sellPrice: 120,
      buyPrice: 110, costBasis: 4_400, proceeds: 4_800, fee: 5, tax: 3, realizedPnl: 392,
    });
    expect(updated.transactions.find((event) => event.type === "buy")?.price).toBe(110);
    expect(updated.transactionRevisions.at(-1)?.previous.price).toBe(100);
    expect(sold.sales[0].realizedPnl).toBe(792);
  });


  it("uses ex-date ownership for automatic dividend amounts regardless of recording order", () => {
    const initial = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "驗證股票", quantity: 100, buyPrice: 100, buyDate: "2026-11-02",
    });
    const id = initial.holdings[0].id;
    const dividend = {
      id: "fixture-excash", holdingId: id, symbol: "2330", market: "tse" as const, name: "驗證股票",
      type: "cash_dividend" as const, effectiveDate: "2026-11-10", source: "twse" as const, exDividendLabel: "除息",
      stockDividendRatio: 0, subscriptionRatio: 0, cashDividend: 5, autoApplicable: true,
    };
    const announced = applyCorporateAction(initial, dividend);
    const earlierSale = { id, quantity: 40, sellPrice: 115, sellDate: "2026-11-06" };
    const recordedLate = sellHolding(announced, earlierSale);
    const recordedEarly = applyCorporateAction(sellHolding(initial, earlierSale), dividend);
    const afterEx = applyCorporateAction(sellHolding(initial, { ...earlierSale, sellDate: "2026-11-12" }), dividend);
    const onEx = sellHolding(announced, { ...earlierSale, sellDate: "2026-11-10" });
    for (const [state, value] of [[recordedLate, 300], [recordedEarly, 300], [afterEx, 500], [onEx, 500]] as const) {
      expect(state.transactions.find((event) => event.corporateActionEventId === dividend.id)?.amount).toBe(value);
      expect(state.corporateActions[0].quantityBefore * 5).toBe(value);
      const calendar = buildPnlCalendar(state, {
        month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
      });
      expect(calendar.days.find((day) => day.date === "2026-11-10")?.contributions[0]?.dividend).toBe(value);
    }
    const closedBeforeEx = sellHolding(announced, { ...earlierSale, quantity: 100 });
    expect(closedBeforeEx.holdings).toHaveLength(0);
    expect(closedBeforeEx.transactions.find((event) => event.corporateActionEventId === dividend.id)?.amount).toBe(0);

    const corrected = editHolding(announced, { ...announced.holdings[0], quantity: 80 });
    expect(corrected.transactions.find((event) => event.corporateActionEventId === dividend.id)?.amount).toBe(400);
    expect(corrected.pnlTracking.dailySummaries["2026-11-10"]?.pnl).toBe(400);
  });


  it("allows closed positions to record a dividend earned before sale or on the sale day", () => {
    const initial = addHolding(defaultPortfolioStorage(), {
      assetType: "fund", symbol: "1234", name: "已出清基金", quantity: 100, buyPrice: 10, buyDate: "2026-11-02",
    });
    const holdingId = initial.holdings[0].id;
    const closed = sellHolding(initial, { id: holdingId, quantity: 100, sellPrice: 12, sellDate: "2026-11-12" });
    const input = { holdingId, effectiveDate: "2026-11-10", settlementDate: "2026-11-22", amount: 500 };
    const paid = addCashDividend(closed, input);
    expect(paid.holdings).toHaveLength(0);
    expect(paid.transactions.at(-1)).toMatchObject({
      holdingId, date: input.effectiveDate, settlementDate: input.settlementDate, amount: input.amount,
      type: "cash_dividend", assetType: "fund",
    });
    expect(paid.pnlTracking.dailySummaries["2026-11-10"]?.pnl).toBe(500);
    expect(addCashDividend(closed, { ...input, effectiveDate: "2026-11-13" })).toBe(closed);
    expect(addCashDividend(closed, { ...input, effectiveDate: "2026-11-02" })).toBe(closed);
    expect(addCashDividend(closed, { ...input, effectiveDate: "2026-11-12" })).not.toBe(closed);
    expect(addCashDividend(paid, input)).toBe(paid);
  });

  it("applies late official cash dividends to an archived stock without changing its sale or reopening it", () => {
    const initial = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "已出清股票", quantity: 100, buyPrice: 100, buyDate: "2026-11-02",
    });
    const id = initial.holdings[0].id;
    const closed = sellHolding(initial, { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-12" });
    const event = {
      id: "fixture-archived", holdingId: id, symbol: "2330", market: "tse" as const, name: "已出清股票",
      type: "mixed" as const, effectiveDate: "2026-11-10", source: "twse" as const, exDividendLabel: "權息",
      stockDividendRatio: 0.1, subscriptionRatio: 0, cashDividend: 5, autoApplicable: true,
    };
    const paid = applyCorporateAction(closed, event);
    expect(paid.holdings).toEqual([]);
    expect(paid.sales).toEqual(closed.sales);
    expect(paid.transactions.at(-1)).toMatchObject({
      holdingId: id, type: "cash_dividend", amount: 500, corporateActionEventId: event.id,
    });
    expect(paid.corporateActions[0]).toMatchObject({ actionType: "cash_dividend", quantityBefore: 100, quantityAfter: 100 });
    expect(applyCorporateAction(closed, { ...event, effectiveDate: "2026-11-13" })).toBe(closed);
    expect(applyCorporateAction(closed, { ...event, cashDividend: undefined })).toBe(closed);
    expect(applyCorporateAction(closed, { ...event, symbol: "2317" })).toBe(closed);
    const manual = addCashDividend(closed, { holdingId: id, effectiveDate: event.effectiveDate, amount: 500 });
    const reconciled = applyCorporateAction(manual, event);
    expect(reconciled.transactions.filter((item) => item.type === "cash_dividend")).toHaveLength(1);
    expect(reconciled.transactions.at(-1)).toMatchObject({ amount: 500, source: "user" });
  });

  it("retains archived valuation gains and adds a late dividend exactly once", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const initial = addHolding(defaultPortfolioStorage(), { assetType: "stock", symbol: "2330", name: "歷史配息測試",
        quantity: 100, buyPrice: 100, buyDate: "2022-11-02" });
      const id = initial.holdings[0].id;
      const withPrice = applyPriceUpdate(applyPriceUpdate(initial, id, 100, "2022-11-03", "api"), id, 104, "2022-11-04", "api");
      const input = { holdingId: id, effectiveDate: "2022-11-04", amount: 50 };
      const paid = addCashDividend(withPrice, input);
      const day = (state: typeof paid) => buildPnlCalendar(state, {
        month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
      }).days.find(({ date }) => date === input.effectiveDate);
      expect(day(paid)).toMatchObject({ pnl: 450, returnRate: 4.5 });

      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const expire = (state: typeof paid) => applyPriceUpdate(state, id, 130, "2026-11-25", "api");
      const expired = expire(paid);
      expect(expired.priceHistory[id].map(({ date }) => date)).toEqual(["2026-11-25"]);
      expect(day(expired)).toMatchObject({ pnl: 450, returnRate: 4.5 });
      const additional = addCashDividend(expired, { ...input, amount: 25 });
      expect(day(additional)).toMatchObject({ pnl: 475, returnRate: 4.75 });
      expect(addCashDividend(additional, { ...input, amount: 25 })).toBe(additional);
      const late = addCashDividend(expire(withPrice), input);
      expect(day(late)).toMatchObject({ pnl: 450, returnRate: null });
      const official = applyCorporateAction(expire(withPrice), {
        id: "fixture-late-official-dividend", holdingId: id, symbol: "2330", market: "tse", name: "歷史配息測試",
        type: "cash_dividend", effectiveDate: input.effectiveDate, source: "twse", exDividendLabel: "除息",
        stockDividendRatio: 0, subscriptionRatio: 0, cashDividend: 0.5, autoApplicable: true,
      });
      expect(day(official)).toMatchObject({ pnl: 450, returnRate: null });
    } finally {
      vi.useRealTimers();
    }
  });

});
