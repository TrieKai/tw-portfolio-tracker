import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPortfolioStorage } from "./parse-portfolio";
import { addHolding, applyPriceUpdate, removeHolding, updateHolding, updateSettings } from "./portfolio-store";
import { applyHistoryResults, applyQuoteResults } from "./portfolio-price-results";
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
  });
});
