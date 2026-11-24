import { afterEach, describe, expect, it, vi } from "vitest";
import type { Holding } from "@/lib/types/holding";
import { fetchHistoryForHoldings } from "./holding-history";

const holding: Holding = {
  id: "holding-1", assetType: "stock", market: "tse", name: "測試標的", symbol: "2330",
  buyPrice: 100, quantity: 10, buyDate: "2026-01-01",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
const range = { startDate: "2026-09-01", endDate: "2026-10-31" };

describe("歷史補資料的日期格式", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("上市和同標的多筆持倉共用同一組 ISO 起訖查詢", async () => {
    const fetch = vi.fn(async () => Response.json({
      success: true, data: { points: [{ date: "2026-09-01", price: 102 }] },
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchHistoryForHoldings([holding, { ...holding, id: "holding-2" }], range);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/prices/stock-history", expect.objectContaining({
      body: JSON.stringify({ symbol: "2330", market: "tse", ...range }),
    }));
    expect(result.map((item) => item.holdingId)).toEqual(["holding-1", "holding-2"]);
  });

  it("集保收到斜線分隔的日期，淨值轉成持倉價格", async () => {
    const fetch = vi.fn(async () => Response.json({
      success: true, data: { points: [{ date: "2026-09-01", nav: 12.34 }] },
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchHistoryForHoldings([{
      ...holding, assetType: "fund", symbol: "18480065", market: undefined,
    }], range);
    expect(fetch).toHaveBeenCalledWith("/api/fund-nav/history", expect.objectContaining({
      body: JSON.stringify({ fundCode: "18480065", startDate: "2026/09/01", endDate: "2026/10/31" }),
    }));
    expect(result).toEqual([{ holdingId: holding.id, ok: true, points: [
      { date: "2026-09-01", price: 12.34, source: "api" },
    ] }]);
  });
});
