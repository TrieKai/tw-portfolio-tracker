import { describe, expect, it, vi } from "vitest";
import { addCashDividend, addHolding, applyCorporateAction, applyManualCorporateAction, applyPriceUpdate, editHolding, removeHolding, sellHolding } from "@/lib/storage/portfolio-store";
import { addLoan, recordLoanBalance, recordLoanPayment, recordLoanRateChange, restartLoan, setLoanStatus } from "@/lib/storage/loan-store";
import { applyImportMode, buildExportFile, mergePortfolioStorage, parseImportPayload, PortfolioImportReviewRequired } from "@/lib/storage/portfolio-export";
import { calculateLoanSnapshot, calculatePortfolioLoanSummary, estimateLoanFinancingCostForPeriod } from "@/lib/loans/calculations";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { defaultPortfolioStorage, hasPortfolioData } from "@/lib/storage/parse-portfolio";

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
  it("reports malformed entries in wrapped and bare backups before using their valid records", () => {
    const portfolio = savedPortfolio();
    const malformed = { ...portfolio, holdings: [...portfolio.holdings, null] };
    for (const raw of [malformed, { app: "tw-portfolio-tracker", exportVersion: 1, portfolio: malformed }]) {
      expect(parseImportPayload(raw)).toEqual({ ok: false, error: "資料欄位 holdings[1] 的格式無效。" });
    }
    expect(parseImportPayload({ ...portfolio, loans: [null] })).toMatchObject({ ok: false, error: expect.stringContaining("loans[0]") });
    expect(parseImportPayload({ ...portfolio, loans: [{ ...portfolio.loans[0], paymentHistory: [null] }] }))
      .toMatchObject({ ok: false, error: expect.stringContaining("loans[0].paymentHistory[0]") });
    expect(parseImportPayload({ ...portfolio, sales: [null] })).toMatchObject({ ok: false, error: expect.stringContaining("sales[0]") });
    expect(parseImportPayload({ ...portfolio, priceHistory: { sample: [{ date: "2026-11-07", price: "10", source: "manual" }] } }))
      .toMatchObject({ ok: false, error: expect.stringContaining('priceHistory["sample"][0].price') });
    expect(parseImportPayload(portfolio)).toMatchObject({ ok: true, portfolio: JSON.parse(JSON.stringify(portfolio)) });
  });

  it("recognizes a backup with historical transactions and no remaining assets", () => {
    const invested = savedPortfolio();
    const archive = { ...defaultPortfolioStorage(), transactions: invested.transactions };
    const parsed = parseImportPayload(archive);
    expect(parsed.ok && hasPortfolioData(parsed.portfolio)).toBe(true);
    expect(hasPortfolioData(defaultPortfolioStorage())).toBe(false);
  });

  it("keeps a removed lot out of old and repeat imports while preserving the actual financial records", () => {
    const opened = savedPortfolio();
    const holding = opened.holdings[0];
    const sold = sellHolding(opened, { id: holding.id, quantity: 30, sellPrice: 115, sellDate: "2026-11-05" });
    const paid = applyCorporateAction(sold, {
      id: "retained-dividend", holdingId: holding.id, symbol: holding.symbol, market: "tse", name: holding.name,
      type: "cash_dividend", effectiveDate: "2026-11-08", source: "twse", exDividendLabel: "除息",
      stockDividendRatio: 0, subscriptionRatio: 0, cashDividend: 5, autoApplicable: true,
    });
    const priced = applyPriceUpdate(paid, holding.id, 120, "2026-11-10", "manual");
    const removed = removeHolding(priced, holding.id, "2026-11-12");
    const old = applyPriceUpdate(priced, holding.id, 135, "2026-11-13", "api");
    expect(removed.holdingRemovals).toMatchObject([{ holding: { id: holding.id, quantity: 70 }, removedOn: "2026-11-12" }]);
    const restored = parseImportPayload(JSON.parse(JSON.stringify(removed)));
    if (!restored.ok) throw new Error(restored.error);
    for (const [left, right] of [[restored.portfolio, old], [old, restored.portfolio]]) {
      const merged = mergePortfolioStorage(left, right);
      expect(merged.holdings).toEqual([]);
      expect(merged.sales).toEqual(priced.sales);
      expect(merged.transactions.find((event) => event.type === "cash_dividend")?.amount).toBe(350);
      expect(merged.priceHistory[holding.id]).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2026-11-10", price: 120 })]));
      const history = buildPortfolioHistory(merged);
      expect(history.snapshotOn("2026-11-10")[0]).toMatchObject({ quantity: 70, currentPrice: 120 });
      expect(history.snapshotOn("2026-11-12")).toEqual([]);
      const calendar = buildPnlCalendar(merged, { month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" } });
      expect(calendar.days.find((day) => day.date === "2026-11-08")?.contributions[0]?.dividend).toBe(350);
      expect(calendar.days.find((day) => day.date === "2026-11-13")).toBeUndefined();
      expect(mergePortfolioStorage(merged, old).holdingRemovals).toHaveLength(1);
      expect(mergePortfolioStorage(merged, old).holdings).toEqual([]);
    }
    expect(applyImportMode(restored.portfolio, old, "replace").holdings[0].id).toBe(holding.id);

    const newPurchase = addHolding(restored.portfolio, { ...holding, quantity: 20, buyDate: "2026-11-14" });
    expect(mergePortfolioStorage(newPurchase, old).holdings).toMatchObject([{ id: newPurchase.holdings[0].id, quantity: 20 }]);
  });

  it("keeps removal-only backups recognizable and trusts the removal when old data also has the lot", () => {
    const added = addHolding(defaultPortfolioStorage(), { assetType: "property", symbol: "HOME", name: "房屋",
      quantity: 1, buyPrice: 1_000_000, buyDate: "2026-11-02" });
    const removed = removeHolding(added, added.holdings[0].id, "2026-11-12");
    expect(removed.transactions).toEqual([]);
    expect(hasPortfolioData(removed)).toBe(true);
    expect(parseImportPayload({ ...removed, holdings: added.holdings })).toMatchObject({ ok: true, portfolio: { holdings: [] } });
  });
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

  it("restores a legacy quote that was superseded by an older manual entry", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const priced = applyPriceUpdate(initial, id, 130, "2026-11-24", "api");
    const backfill = applyPriceUpdate(priced, id, 120, "2026-11-20", "manual");
    const old: typeof backfill = { ...backfill, holdings: [{
      ...backfill.holdings[0], currentPrice: 120, priceDate: "2026/11/20", priceSource: "manual",
    }] };
    const parsed = parseImportPayload(JSON.parse(JSON.stringify(buildExportFile(old))));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.portfolio.holdings[0]).toMatchObject({ currentPrice: 130, priceDate: "2026-11-24", priceSource: "api" });
    expect(parsed.portfolio.priceHistory[id]).toEqual(backfill.priceHistory[id]);
    expect(applyImportMode(initial, parsed.portfolio, "replace").holdings[0]).toEqual(parsed.portfolio.holdings[0]);
  });

  it("keeps the daily totals from the chosen close when two backups disagree", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const initial = addHolding(defaultPortfolioStorage(), {
        assetType: "stock", name: "台積電", symbol: "2330", quantity: 100, buyPrice: 100, buyDate: "2022-11-02",
      });
      const id = initial.holdings[0].id;
      const sold = sellHolding(initial, { id, quantity: 60, sellPrice: 115, sellDate: "2022-11-04" });
      const local = applyPriceUpdate(applyPriceUpdate(sold, id, 110, "2022-11-03", "manual"), id, 120, "2022-11-07", "api");
      vi.setSystemTime(new Date("2022-11-07T11:00:00.000Z"));
      const backup = applyPriceUpdate(applyPriceUpdate(sold, id, 105, "2022-11-03", "api"), id, 120, "2022-11-07", "api");
      const merged = mergePortfolioStorage(local, backup);
      expect(merged.priceHistory[id].map(({ price }) => price)).toEqual([110, 120]);
      const pnl = (state: typeof local) => Object.values(state.pnlTracking.dailySummaries)
        .sort((a, b) => a.date.localeCompare(b.date)).map(({ date, pnl }) => [date, pnl]);
      expect(pnl(merged)).toEqual([["2022-11-03", 1000], ["2022-11-04", 300], ["2022-11-07", 400]]);

      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const expired = applyPriceUpdate(merged, id, 130, "2026-11-25", "api");
      for (const restored of [expired, mergePortfolioStorage(expired, backup)]) {
        const days = buildPnlCalendar(restored, {
          month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
        }).days.map(({ date, pnl }) => [date, pnl]);
        expect(days).toEqual(pnl(local));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds the daily totals when merging quotes that only exist on separate devices", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const later = applyPriceUpdate(initial, id, 130, "2026-11-24", "api");
    const earlier = applyPriceUpdate(initial, id, 110, "2026-11-23", "manual");
    expect(later.pnlTracking.dailySummaries["2026-11-24"].pnl).toBe(3000);
    for (const merged of [mergePortfolioStorage(later, earlier), mergePortfolioStorage(earlier, later)]) {
      expect(merged.pnlTracking.dailySummaries["2026-11-23"].pnl).toBe(1000);
      expect(merged.pnlTracking.dailySummaries["2026-11-24"].pnl).toBe(2000);
      expect(merged.holdings[0]).toMatchObject({ currentPrice: 130, priceDate: "2026-11-24" });
    }
  });

  it("rebuilds stale totals from the newer acquisition even when both backups have the same quotes", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const original = applyPriceUpdate(applyPriceUpdate(initial, id, 110, "2026-11-06", "api"), id, 120, "2026-11-09", "api");
    const corrected = editHolding(original, { ...original.holdings[0], buyPrice: 105, quantity: 80 });
    const legacy = { ...corrected, pnlTracking: { ...corrected.pnlTracking, dailySummaries: {} } };
    for (const [local, backup] of [[legacy, original], [original, legacy]]) {
      const merged = mergePortfolioStorage(local, backup);
      expect(merged.holdings[0]).toMatchObject({ buyPrice: 105, quantity: 80 });
      expect(merged.pnlTracking.dailySummaries["2026-11-06"]?.pnl).toBe(400);
      expect(merged.pnlTracking.dailySummaries["2026-11-09"]?.pnl).toBe(800);
      const repeated = mergePortfolioStorage(merged, original);
      expect(repeated.pnlTracking.dailySummaries).toEqual(merged.pnlTracking.dailySummaries);
    }
  });

  it("records the combined buy fees when two devices acquire different lots on the same day", () => {
    const empty = defaultPortfolioStorage();
    const local = addHolding(empty, { assetType: "stock", symbol: "2330", name: "台積電",
      quantity: 100, buyPrice: 100, buyDate: "2026-11-02", fee: 25 });
    const backup = addHolding(empty, { assetType: "fund", symbol: "0101", name: "測試基金",
      quantity: 10, buyPrice: 40, buyDate: "2026-11-02", fee: 15 });
    for (const [a, b] of [[local, backup], [backup, local]]) {
      const merged = mergePortfolioStorage(a, b);
      expect(merged.holdings).toHaveLength(2);
      expect(merged.pnlTracking.dailySummaries["2026-11-02"]).toMatchObject({ pnl: -40, returnRate: null });
      expect(mergePortfolioStorage(merged, b).pnlTracking.dailySummaries).toEqual(merged.pnlTracking.dailySummaries);
    }
  });

  it("does not restore a holding already sold in full", () => {
    const older = savedPortfolio();
    const sold = sellHolding(older, {
      id: older.holdings[0].id, quantity: 100, sellPrice: 110, sellDate: "2026-11-06",
    });
    const merged = mergePortfolioStorage(sold, older);

    expect(merged.holdings).toEqual([]);
    expect(merged.sales).toEqual(sold.sales);
    expect(merged.holdingRemovals).toEqual([]);
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

  it("merges the same manual dividend across devices while preserving its settlement details", () => {
    const opened = savedPortfolio();
    const input = { holdingId: opened.holdings[0].id, effectiveDate: "2026-11-10", amount: 500 };
    const local = addCashDividend(opened, { ...input, note: "依存摺核對" });
    const backup = addCashDividend(opened, { ...input, settlementDate: "2026-11-20" });
    for (const merged of [mergePortfolioStorage(local, backup), mergePortfolioStorage(backup, local)]) {
      const dividends = merged.transactions.filter((event) => event.type === "cash_dividend");
      expect(dividends).toHaveLength(1);
      expect(dividends[0]).toMatchObject({ amount: 500, note: "依存摺核對", settlementDate: "2026-11-20" });
      expect(mergePortfolioStorage(merged, backup).transactions).toEqual(merged.transactions);
      const calendar = buildPnlCalendar(merged, {
        month: "2026-11", asOfDate: "2026-11-24", filter: { kind: "investment" },
      });
      expect(calendar.days.find((day) => day.date === input.effectiveDate)?.pnl).toBe(500);
    }
  });

  it("merges distinct dividends without losing the same day's archived valuation", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const stock = { assetType: "stock" as const, quantity: 100, buyPrice: 100, buyDate: "2022-11-02" };
      const a = addHolding(defaultPortfolioStorage(), { ...stock, symbol: "2330", name: "台積電" });
      const initial = addHolding(a, { ...stock, symbol: "2317", name: "鴻海" });
      const [id, other] = initial.holdings.map((holding) => holding.id);
      const date = "2022-11-04";
      const priced = applyPriceUpdate(applyPriceUpdate(initial, id, 100, "2022-11-03", "api"), id, 104, date, "api");
      const local = addCashDividend(priced, { holdingId: id, effectiveDate: date, amount: 50 });
      const backup = addCashDividend(priced, { holdingId: other, effectiveDate: date, amount: 25 });
      expect(mergePortfolioStorage(local, backup).pnlTracking.dailySummaries[date].pnl).toBe(475);
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const expire = (state: typeof local) => applyPriceUpdate(state, id, 130, "2026-11-25", "api");
      for (const merged of [mergePortfolioStorage(expire(local), expire(backup)), mergePortfolioStorage(expire(backup), expire(local))]) {
        expect(merged.pnlTracking.dailySummaries[date]).toMatchObject({ pnl: 475, returnRate: null });
        const repeated = mergePortfolioStorage(merged, backup);
        expect(repeated.pnlTracking.dailySummaries[date].pnl).toBe(475);
        const calendar = buildPnlCalendar(repeated, {
          month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
        });
        expect(calendar.days.find((day) => day.date === date)?.pnl).toBe(475);
        expect(repeated.transactions.filter((event) => event.type === "cash_dividend")).toHaveLength(2);
      }
    } finally {
      vi.useRealTimers();
    }
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


  it("requires confirmation before merging independently entered duplicate full sales", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const sale = { id, quantity: 100, sellPrice: 120, sellDate: "2026-11-06" };
    const local = sellHolding(initial, sale);
    const backup = sellHolding(initial, { ...sale, fee: 10 });
    // 舊資料沒有 saleId，仍須移除該筆成交對應的賣出事件。
    local.transactions = local.transactions.map((event) => ({ ...event, saleId: undefined }));
    try {
      mergePortfolioStorage(local, backup);
      throw new Error("Missing sale review");
    } catch (error) {
      expect(error).toBeInstanceOf(PortfolioImportReviewRequired);
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "duplicate", canKeepBoth: false });
      expect(() => mergePortfolioStorage(local, backup, { [conflict.key]: "both" })).toThrow(PortfolioImportReviewRequired);
      for (const [choice, selected] of [["local", local], ["backup", backup]] as const) {
        const merged = mergePortfolioStorage(local, backup, { [conflict.key]: choice });
        expect(merged.holdings).toEqual([]);
        expect(merged.sales).toEqual(selected.sales);
        expect(merged.transactions.filter((event) => event.type === "sell")).toHaveLength(1);
        expect(buildPortfolioHistory(merged).snapshotOn("2026-11-05")[0]?.quantity).toBe(100);
      }
    }
  });

  it("keeps a single partial sale when choosing either source and permits legitimate separate fills", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const sale = { id, quantity: 30, sellPrice: 120, sellDate: "2026-11-06" };
    const local = sellHolding(initial, sale);
    const backup = sellHolding(initial, { ...sale, fee: 10 });
    try {
      mergePortfolioStorage(local, backup);
      throw new Error("Missing sale review");
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "duplicate", canKeepBoth: true });
      const once = mergePortfolioStorage(local, backup, { [conflict.key]: "backup" });
      expect(once.holdings[0].quantity).toBe(70);
      expect(once.sales[0].id).toBe(backup.sales[0].id);
      expect(once.transactions.filter((event) => event.type === "sell")).toHaveLength(1);
      const exported = parseImportPayload(JSON.parse(JSON.stringify(buildExportFile(once))));
      if (!exported.ok) throw new Error(exported.error);
      const restored = applyImportMode(initial, exported.portfolio, "replace");
      for (const repeated of [mergePortfolioStorage(restored, local), mergePortfolioStorage(local, restored)]) {
        expect(repeated.holdings[0].quantity).toBe(70);
        expect(repeated.sales).toEqual(backup.sales);
        expect(repeated.transactions.filter((event) => event.type === "sell")).toHaveLength(1);
      }
      const twice = mergePortfolioStorage(local, backup, { [conflict.key]: "both" });
      expect(twice.holdings[0].quantity).toBe(40);
      expect(twice.sales).toHaveLength(2);
      once.saleImportReviews![0].reviewedAt = "2026-11-24T00:00:00.000Z";
      twice.saleImportReviews![0].reviewedAt = "2026-11-25T00:00:00.000Z";
      for (const merged of [mergePortfolioStorage(once, twice), mergePortfolioStorage(twice, once)]) {
        expect(merged.holdings[0].quantity).toBe(40);
        expect(merged.sales.map(({ id }) => id).sort()).toEqual(twice.sales.map(({ id }) => id).sort());
        expect(mergePortfolioStorage(merged, local).holdings[0].quantity).toBe(40);
      }
      const third = sellHolding(initial, { ...sale, fee: 20 });
      expect(() => mergePortfolioStorage(restored, third)).toThrow(PortfolioImportReviewRequired);
      expect(parseImportPayload({ ...once, saleImportReviews: [{ ...once.saleImportReviews![0],
        excludedIds: once.saleImportReviews![0].includedIds }] }))
        .toMatchObject({ ok: false, error: expect.stringContaining("saleImportReviews[0].excludedIds") });
    }
  });

  it("retains a corrected cost for the same sale id on repeat imports", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const local = sellHolding(initial, { id, quantity: 40, sellPrice: 120, sellDate: "2026-11-06" });
    const sameMillisecond = new Date(Date.now() + 2000).toISOString();
    local.sales[0].createdAt = sameMillisecond;
    local.holdings[0].updatedAt = sameMillisecond;
    const backup = editHolding(local, { ...local.holdings[0], buyPrice: 110 });
    for (const merged of [mergePortfolioStorage(local, backup), mergePortfolioStorage(backup, local)]) {
      expect(merged.sales[0].realizedPnl).toBe(400);
      expect(merged.holdings[0].buyPrice).toBe(110);
    }
  });


  it("requires a choice when different sales would exceed the original position", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const local = sellHolding(initial, { id, quantity: 70, sellPrice: 120, sellDate: "2026-11-05" });
    const backup = sellHolding(initial, { id, quantity: 60, sellPrice: 110, sellDate: "2026-11-06" });
    try {
      mergePortfolioStorage(local, backup);
      throw new Error("Missing oversell review");
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "oversold", capacity: 100, mergedQuantity: 130, canKeepBoth: false });
      expect(() => mergePortfolioStorage(local, backup, { [conflict.key]: "both" })).toThrow(PortfolioImportReviewRequired);
      for (const [choice, quantity, soldId] of [
        ["local", 30, local.sales[0].id],
        ["backup", 40, backup.sales[0].id],
      ] as const) {
        const merged = mergePortfolioStorage(local, backup, { [conflict.key]: choice });
        expect(merged.holdings[0].quantity).toBe(quantity);
        expect(merged.sales.map((sale) => sale.id)).toEqual([soldId]);
        expect(buildPortfolioHistory(merged).snapshotOn("2026-11-03")[0]?.quantity).toBe(100);
        expect(merged.transactions.filter((event) => event.type === "sell")).toHaveLength(1);
        const repeated = mergePortfolioStorage(merged, choice === "local" ? backup : local);
        expect(repeated.holdings[0].quantity).toBe(quantity);
        expect(repeated.sales).toEqual(merged.sales);
      }
    }
  });

  it("keeps a partial position when rejecting a full sale that follows a shared sale", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const common = sellHolding(initial, { id, quantity: 20, sellPrice: 110, sellDate: "2026-11-05" });
    const closed = sellHolding(common, { id, quantity: 80, sellPrice: 120, sellDate: "2026-11-06" });
    const partial = sellHolding(common, { id, quantity: 50, sellPrice: 125, sellDate: "2026-11-07" });
    expect(closed.holdings).toEqual([]);
    try {
      mergePortfolioStorage(closed, partial);
      throw new Error("Missing oversell review");
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "oversold", capacity: 100, mergedQuantity: 150 });
      const chosen = mergePortfolioStorage(closed, partial, { [conflict.key]: "backup" });
      expect(chosen.holdings[0]?.quantity).toBe(30);
      expect(chosen.sales).toEqual(partial.sales);
      expect(chosen.transactions.filter((event) => event.type === "sell")).toHaveLength(2);
      expect(mergePortfolioStorage(closed, chosen).holdings[0]?.quantity).toBe(30);
      expect(mergePortfolioStorage(chosen, closed).holdings[0]?.quantity).toBe(30);
    }
  });

  it("keeps expired calendar totals calculated from the chosen trades when an old backup is merged again", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2022-11-07T10:00:00.000Z"));
      const opened = addHolding(defaultPortfolioStorage(), {
        assetType: "stock", name: "台積電", symbol: "2330", quantity: 100,
        buyPrice: 100, buyDate: "2022-11-02",
      });
      const id = opened.holdings[0].id;
      const priced = applyPriceUpdate(opened, id, 110, "2022-11-03", "manual");
      const sell = { id, quantity: 60, sellPrice: 115, sellDate: "2022-11-04" };
      const kept = applyPriceUpdate(sellHolding(priced, sell), id, 120, "2022-11-07", "manual");
      vi.setSystemTime(new Date("2022-11-07T11:00:00.000Z"));
      const rejected = applyPriceUpdate(sellHolding(priced, { ...sell, quantity: 70 }), id, 120, "2022-11-07", "manual");
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const local = applyPriceUpdate(kept, id, 130, "2026-11-25", "manual");
      const backup = applyPriceUpdate(rejected, id, 130, "2026-11-25", "manual");
      const days = (state: typeof local) => buildPnlCalendar(state, {
        month: "2022-11", asOfDate: "2022-11-30", filter: { kind: "investment" },
      }).days.map(({ date, pnl }) => [date, pnl]);
      expect(local.priceHistory[id].map((point) => point.date)).toEqual(["2026-11-25"]);
      expect(days(local)).toEqual([["2022-11-03", 1000], ["2022-11-04", 300], ["2022-11-07", 400]]);
      expect(days(backup)).toEqual([["2022-11-03", 1000], ["2022-11-04", 350], ["2022-11-07", 300]]);
      try {
        mergePortfolioStorage(local, backup);
        throw new Error("Missing oversell review");
      } catch (error) {
        if (!(error instanceof PortfolioImportReviewRequired)) throw error;
        const [conflict] = error.conflicts;
        expect(conflict).toMatchObject({ kind: "oversold" });
        const merged = mergePortfolioStorage(local, backup, { [conflict.key]: "local" });
        expect(merged.holdings[0].quantity).toBe(40);
        const recalculated = days({ ...merged, priceHistory: kept.priceHistory,
          pnlTracking: { ...merged.pnlTracking, dailySummaries: {} } });
        expect(recalculated).toEqual(days(local).slice(1));
        expect(days(merged)).toEqual(days(local));
        expect(days(mergePortfolioStorage(merged, backup))).toEqual(days(local));
        expect(days(mergePortfolioStorage(backup, merged))).toEqual(days(local));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("compares overlaid sales in the same share units after a split", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const local = sellHolding(initial, { id, quantity: 70, sellPrice: 120, sellDate: "2026-11-05" });
    const split = applyManualCorporateAction(initial, {
      holdingId: id, actionType: "split", effectiveDate: "2026-11-09", adjustmentRatio: 2,
    });
    const backup = sellHolding(split, { id, quantity: 80, sellPrice: 55, sellDate: "2026-11-10" });
    expect(() => mergePortfolioStorage(local, backup)).toThrow(PortfolioImportReviewRequired);
    try {
      mergePortfolioStorage(local, backup);
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "oversold", capacity: 200, mergedQuantity: 220 });
      const merged = mergePortfolioStorage(local, backup, { [conflict.key]: "local" });
      expect(merged.holdings[0].quantity).toBe(60);
      expect(merged.holdings[0].buyPrice).toBe(50);
    }
  });

  it("keeps corrected purchase fields and a later independent quote in both merge directions", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const corrected = editHolding(initial, { ...initial.holdings[0], buyPrice: 110, quantity: 90 });
    const quoted = applyPriceUpdate(initial, id, 130, "2026-11-10", "manual");
    quoted.holdings[0].updatedAt = new Date(Date.now() + 1000).toISOString();

    for (const [local, backup] of [[corrected, quoted], [quoted, corrected]]) {
      const merged = mergePortfolioStorage(local, backup);
      expect(merged.holdings[0]).toMatchObject({ quantity: 90, buyPrice: 110, currentPrice: 130, priceDate: "2026-11-10" });
      expect(merged.transactions.find((item) => item.type === "buy")).toMatchObject({ quantity: 90, price: 110 });
    }
  });

  it("merges loan balance, rate, and payment events while keeping the latest contract status", () => {
    const initial = savedPortfolio();
    const id = initial.loans[0].id;
    const closed = setLoanStatus(initial, id, "paid_off", "2026-11-20", "2026-11-20T00:00:00.000Z");
    const local = recordLoanBalance(closed, id, 80_000, "2026-11-08", "2026-11-21T00:00:00.000Z");
    const rate = recordLoanRateChange(initial, id, {
      effectiveDate: "2026-11-10", annualInterestRate: 4,
    }, "2026-11-22T00:00:00.000Z");
    const backup = recordLoanPayment(rate, id, {
      paymentDate: "2026-11-12", principalPaid: 0, interestPaid: 75,
      feePaid: 3, subsidyReceived: 0,
    }, "2026-11-23T00:00:00.000Z");
    const merged = mergePortfolioStorage(local, backup).loans[0];
    expect(merged.status).toBe("paid_off");
    expect(merged.paymentHistory?.[0]).toMatchObject({ interestPaid: 75, feePaid: 3 });
    expect(calculateLoanSnapshot(merged, "2026-11-15")).toMatchObject({
      currentPrincipal: 80_000, currentAnnualInterestRate: 4,
    });
  });


  it("requires review before charging the same loan payment twice and remembers the chosen records", () => {
    const initial = savedPortfolio();
    const id = initial.loans[0].id;
    const payment = { paymentDate: "2026-11-12", principalPaid: 2_000, interestPaid: 0,
      feePaid: 300, subsidyReceived: 0, remainingPrincipalAfter: 98_000 };
    const local = recordLoanPayment(initial, id, { ...payment, note: "本機註記" }, "2026-11-12T00:00:00.000Z");
    const backup = recordLoanPayment(initial, id, { ...payment, note: "備份註記" }, "2026-11-12T00:00:01.000Z");
    const localPayment = local.loans[0].paymentHistory![0];
    const backupPayment = backup.loans[0].paymentHistory![0];
    expect(mergePortfolioStorage(local, local).loans[0].paymentHistory).toEqual([localPayment]);
    expect(() => mergePortfolioStorage(local, backup)).toThrow(PortfolioImportReviewRequired);
    try {
      mergePortfolioStorage(local, backup);
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict).toMatchObject({ kind: "loan_payment", local: [localPayment], backup: [backupPayment] });
      expect(() => mergePortfolioStorage(local, backup, { [conflict.key]: [] })).toThrow(PortfolioImportReviewRequired);
      expect(() => mergePortfolioStorage(local, backup, { [conflict.key]: ["unknown"] })).toThrow(PortfolioImportReviewRequired);
      const once = mergePortfolioStorage(local, backup, { [conflict.key]: [backupPayment.id] });
      expect(once.loans[0].paymentHistory).toEqual([backupPayment]);
      expect(calculateLoanSnapshot(once.loans[0], "2026-11-12").currentPrincipal).toBe(98_000);
      const cost = (loan: typeof initial.loans[number]) => estimateLoanFinancingCostForPeriod(loan, "2026-11-02", "2026-11-12");
      expect(cost(once.loans[0])).toBe(cost(local.loans[0]));
      const exported = parseImportPayload(JSON.parse(JSON.stringify(once)));
      if (!exported.ok) throw new Error(exported.error);
      const restored = applyImportMode(initial, exported.portfolio, "replace");
      expect(mergePortfolioStorage(restored, local).loans[0].paymentHistory).toEqual([backupPayment]);
      expect(mergePortfolioStorage(local, restored).loans[0].paymentHistory).toEqual([backupPayment]);
      const both = mergePortfolioStorage(local, backup, { [conflict.key]: [localPayment.id, backupPayment.id] });
      expect(cost(both.loans[0])).toBeCloseTo(cost(once.loans[0]) + 300);
      expect(mergePortfolioStorage(both, backup).loans[0].paymentHistory).toEqual([localPayment, backupPayment]);
      const conflicting = mergePortfolioStorage(local, backup, { [conflict.key]: [localPayment.id] });
      conflicting.loans[0].paymentImportReviews![0].reviewedAt = "2026-11-24T00:00:00.000Z";
      once.loans[0].paymentImportReviews![0].reviewedAt = "2026-11-25T00:00:00.000Z";
      expect(mergePortfolioStorage(conflicting, once).loans[0].paymentHistory).toEqual([backupPayment]);
      expect(mergePortfolioStorage(once, conflicting).loans[0].paymentHistory).toEqual([backupPayment]);
      const changedBackup = {
        ...backup,
        loans: [{ ...backup.loans[0], paymentHistory: [{ ...backupPayment, note: "後來更正的備註" }] }],
      };
      expect(() => mergePortfolioStorage(local, changedBackup, { [conflict.key]: [localPayment.id] }))
        .toThrow(PortfolioImportReviewRequired);
    }
  });

  it("reviews matching payments after separately restarted loan phases are matched", () => {
    const initial = savedPortfolio();
    const original = initial.loans[0];
    const closed = setLoanStatus(initial, original.id, "paid_off", "2026-11-06", "2026-11-07T00:00:00.000Z");
    const terms = { ...original, trackingStartDate: "2026-11-10", openingBalance: 50_000 };
    const payment = { paymentDate: "2026-11-12", principalPaid: 0, interestPaid: 0, feePaid: 300, subsidyReceived: 0 };
    const prepare = (when: string, note: string) => {
      const restarted = restartLoan(closed, original.id, terms, when);
      return recordLoanPayment(restarted, restarted.loans.at(-1)!.id, { ...payment, note }, when);
    };
    const local = prepare("2026-11-12T01:00:00.000Z", "本機");
    const backup = prepare("2026-11-12T02:00:00.000Z", "備份");
    try {
      mergePortfolioStorage(local, backup);
      throw new Error("Missing loan payment review");
    } catch (error) {
      if (!(error instanceof PortfolioImportReviewRequired)) throw error;
      const [conflict] = error.conflicts;
      expect(conflict.kind).toBe("loan_payment");
      const kept = backup.loans.at(-1)!.paymentHistory![0];
      const merged = mergePortfolioStorage(local, backup, { [conflict.key]: [kept.id] });
      const reimported = mergePortfolioStorage(merged, local);
      expect(reimported.loans).toHaveLength(2);
      expect(reimported.loans.find((loan) => loan.status === "active")?.paymentHistory).toEqual([kept]);
    }
  });

  it("reconciles cost corrections to a sale entered independently on the other device", () => {
    const initial = savedPortfolio();
    const id = initial.holdings[0].id;
    const corrected = editHolding(initial, { ...initial.holdings[0], buyPrice: 110 });
    for (const quantity of [40, 100]) {
      const sold = sellHolding(initial, { id, quantity, sellPrice: 120, sellDate: "2026-11-05", fee: 10 });
      for (const [local, backup] of [[corrected, sold], [sold, corrected]]) {
        const merged = mergePortfolioStorage(local, backup);
        expect(merged.sales[0]).toMatchObject({ buyPrice: 110, costBasis: quantity * 110, realizedPnl: quantity * 10 - 10 });
        expect(buildPortfolioHistory(merged).snapshotOn("2026-11-03")[0]?.buyPrice).toBe(110);
      }
    }
  });


  it("merges independently restarted loans into one phase while keeping events and revision references", () => {
    const initial = savedPortfolio();
    const original = initial.loans[0];
    const closed = setLoanStatus(initial, original.id, "paid_off", "2026-11-06", "2026-11-07T00:00:00.000Z");
    const terms = { ...original, trackingStartDate: "2026-11-10", openingBalance: 50_000 };
    const a = restartLoan(closed, original.id, terms, "2026-11-11T00:00:00.000Z");
    const b = restartLoan(closed, original.id, terms, "2026-11-12T00:00:00.000Z");
    const aId = a.loans.at(-1)!.id;
    const bId = b.loans.at(-1)!.id;
    const local = recordLoanBalance(a, aId, 48_000, "2026-11-15", "2026-11-15T00:00:00.000Z");
    const backup = recordLoanRateChange(b, bId, {
      effectiveDate: "2026-11-16", annualInterestRate: 4,
    }, "2026-11-16T00:00:00.000Z");
    for (const [left, right] of [[local, backup], [backup, local]]) {
      const merged = mergePortfolioStorage(left, right);
      expect(merged.loans).toHaveLength(2);
      const successor = merged.loans.find((loan) => loan.restartedFromLoanId === original.id)!;
      expect(successor.id).toBe([aId, bId].sort()[0]);
      expect(calculateLoanSnapshot(successor, "2026-11-24")).toMatchObject({
        currentPrincipal: 48_000, currentAnnualInterestRate: 4,
      });
      expect(calculatePortfolioLoanSummary(merged.loans, {
        asOfDate: "2026-11-24", grossInvestmentPnl: 0,
      })).toMatchObject({ activeLoanCount: 1, totalDebt: 48_000 });
      expect(mergePortfolioStorage(merged, right).loans).toHaveLength(2);
    }
  });

  it("remaps subsequent restarts and preserves the original closure when another device undid the closure", () => {
    const initial = savedPortfolio();
    const original = initial.loans[0];
    const closed = setLoanStatus(initial, original.id, "paid_off", "2026-11-06", "2026-11-07T00:00:00.000Z");
    const start = (when: string) => restartLoan(closed, original.id, {
      ...original, trackingStartDate: "2026-11-10", openingBalance: 50_000,
    }, when);
    const a = start("2026-11-11T00:00:00.000Z");
    const b = start("2026-11-12T00:00:00.000Z");
    const reopen = setLoanStatus(closed, original.id, "active", "2026-11-19", "2026-11-19T00:00:00.000Z");
    expect(mergePortfolioStorage(reopen, a).loans.find((loan) => loan.id === original.id))
      .toMatchObject({ status: "paid_off", closedAt: "2026-11-06" });
    const anotherPhase = (state: typeof initial) => {
      const id = state.loans.at(-1)!.id;
      const thenClosed = setLoanStatus(state, id, "paid_off", "2026-11-18", "2026-11-19T00:00:00.000Z");
      return restartLoan(thenClosed, id, {
        ...original, trackingStartDate: "2026-11-20", openingBalance: 20_000,
      }, "2026-11-21T00:00:00.000Z");
    };
    const combined = mergePortfolioStorage(anotherPhase(a), anotherPhase(b));
    expect(combined.loans).toHaveLength(3);
    const second = combined.loans.find((loan) => loan.restartedFromLoanId === original.id)!;
    const third = combined.loans.find((loan) => loan.restartedFromLoanId === second.id)!;
    expect(third).toMatchObject({ openingBalance: 20_000, status: "active" });
    expect(combined.loanRevisions.filter((revision) => revision.previous.restartedFromLoanId === original.id))
      .toEqual(expect.arrayContaining([expect.objectContaining({ loanId: second.id, previous: expect.objectContaining({ id: second.id }) })]));
  });

});
