import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPortfolioStorage } from "./parse-portfolio";
import { addHolding, applyPriceUpdate, removeHolding, sellHolding, updateHolding, updateSettings } from "./portfolio-store";
import { applyHistoryResults, applyQuoteResults } from "./portfolio-price-results";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { addDaysToIsoDate } from "@/lib/date/iso-date";
import type { BatchUpdateItemResult } from "@/lib/types/price-api";

function portfolio() {
  return addHolding(defaultPortfolioStorage(), {
    assetType: "stock", name: "台積電", symbol: "2330", market: "tse",
    buyDate: "2026-09-01", buyPrice: 100, quantity: 10,
  });
}

function quote(holdingId: string): BatchUpdateItemResult {
  return {
    holdingId, ok: true, assetType: "stock", symbol: "2330",
    data: {
      success: true, name: "台積電", symbol: "2330", market: "tse", assetType: "stock",
      price: 115, priceDate: "2026-11-23", currency: "TWD", source: "twse",
    },
  };
}

describe("行情回應只更新發出請求時的標的", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T12:00:00+08:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("保留請求期間新增的持倉、還原後的數量與其他設定", () => {
    const initial = portfolio();
    const [holding] = initial.holdings;
    const edited = updateSettings(updateHolding(initial, holding.id, { quantity: 25 }), { netAssets: 50_000 });
    const latest = addHolding(edited, {
      assetType: "property", symbol: "HOME", name: "測試房產", quantity: 1, buyPrice: 99_999,
      buyDate: "2026-11-02",
    });

    const result = applyQuoteResults(latest, initial.holdings, [quote(holding.id)]);
    expect(result.updated).toBe(1);
    expect(result.next.holdings).toHaveLength(2);
    expect(result.next.holdings[0]).toMatchObject({ quantity: 25, currentPrice: 115 });
    expect(result.next.settings.netAssets).toBe(50_000);
    expect(result.next.transactions).toEqual(latest.transactions);
  });

  it("略過已移除、已更換代號或已有手動更新的持倉", () => {
    const initial = portfolio();
    const id = initial.holdings[0].id;
    const variants = [
      removeHolding(initial, id),
      updateHolding(initial, id, { symbol: "2317" }),
      applyPriceUpdate(initial, id, 120, "2026-11-23", "manual"),
    ];
    for (const latest of variants) {
      const result = applyQuoteResults(latest, initial.holdings, [quote(id)]);
      expect(result).toMatchObject({ next: latest, updated: 0, skipped: 1 });
    }
  });

  it("補歷史時保留手動估價與現在價格", () => {
    const initial = portfolio();
    const id = initial.holdings[0].id;
    let latest = applyPriceUpdate(initial, id, 120, "2026-11-20", "manual");
    latest = applyPriceUpdate(latest, id, 125, "2026-11-24", "api");
    const result = applyHistoryResults(latest, initial.holdings, [
      { holdingId: id, ok: true, points: [
        { date: "2026-11-19", price: 115, source: "api" },
        { date: "2026-11-20", price: 117, source: "api" },
        { date: "2026-11-24", price: 124, source: "api" },
      ] },
    ]);
    expect(result.next.holdings[0]).toMatchObject({ priceDate: "2026-11-24", currentPrice: 125 });
    expect(result.next.priceHistory[id].map((point) => point.price)).toEqual([115, 120, 125]);
    expect(result).toMatchObject({ writtenPoints: 1, skippedPoints: 2, dates: ["2026-11-19"] });
    const retry = applyHistoryResults(result.next, result.next.holdings, [
      { holdingId: id, ok: true, points: [
        { date: "2026-11-19", price: 115, source: "api" },
        { date: "2026-11-20", price: 117, source: "api" },
      ] },
    ]);
    expect(retry.next).toBe(result.next);
    expect(retry).toMatchObject({ writtenPoints: 0, skippedPoints: 2, dates: [] });
  });

  it.each(["自動匯入", "手動輸入"])("%s較早的行情後，保留最新現價並重算受影響的成交與估值", (mode) => {
    const initial = portfolio();
    const [holding] = initial.holdings;
    const id = holding.id;
    const previous = applyPriceUpdate(initial, id, 110, "2026-11-18", "api");
    const sold = sellHolding(previous, { id, quantity: 2, sellPrice: 125, sellDate: "2026-11-23" });
    const priced = applyPriceUpdate(sold, id, 130, "2026-11-24", "api");
    expect(priced.pnlTracking.dailySummaries["2026-11-23"].pnl).toBe(30);
    expect(priced.pnlTracking.dailySummaries["2026-11-24"].pnl).toBe(160);

    const updated = mode === "手動輸入"
      ? applyPriceUpdate(priced, id, 120, "2026-11-20", "manual")
      : applyHistoryResults(priced, priced.holdings, [{ holdingId: id, ok: true,
        points: [{ date: "2026-11-20", price: 120, source: "api" }] }]).next;
    expect(updated.holdings[0]).toMatchObject({ currentPrice: 130, priceDate: "2026-11-24", priceSource: "api" });
    expect(updated.pnlTracking.dailySummaries["2026-11-23"].pnl).toBe(10);
    expect(updated.pnlTracking.dailySummaries["2026-11-24"].pnl).toBe(80);

    vi.setSystemTime(new Date("2030-11-25T12:00:00+08:00"));
    const expired = applyPriceUpdate(updated, id, 140, "2030-11-25", "api");
    expect(expired.priceHistory[id].map((point) => point.date)).toEqual(["2030-11-25"]);
    const calendar = buildPnlCalendar(expired, {
      month: "2026-11", asOfDate: "2026-11-30", filter: { kind: "investment" },
    });
    expect(calendar.days.map(({ date, pnl }) => [date, pnl])).toEqual([
      ["2026-11-18", 100], ["2026-11-20", 100], ["2026-11-23", 10], ["2026-11-24", 80],
    ]);
  });

  it("拒絕超出保留期的回填，並接受保留期首日和既有現價日期", () => {
    const initial = portfolio();
    const id = initial.holdings[0].id;
    const priced = applyPriceUpdate(initial, id, 130, "2026-11-24", "api");
    const earliest = priceHistoryStartDate();
    const before = addDaysToIsoDate(earliest, -1);
    expect(applyPriceUpdate(priced, id, 100, before, "manual")).toBe(priced);
    const backfilled = applyPriceUpdate(priced, id, 105, earliest, "manual");
    expect(backfilled.priceHistory[id][0]).toEqual({ date: earliest, price: 105, source: "manual" });
    expect(backfilled.holdings[0]).toEqual(priced.holdings[0]);
    const corrected = applyPriceUpdate(backfilled, id, 133, "2026-11-24", "manual");
    expect(corrected.holdings[0]).toMatchObject({ currentPrice: 133, priceDate: "2026-11-24", priceSource: "manual" });
  });
});
