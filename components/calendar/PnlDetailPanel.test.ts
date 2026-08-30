import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PnlWeekDetail } from "@/components/calendar/PnlDetailPanel";
import type { PnlCalendarDay, PnlCalendarWeek } from "@/lib/portfolio/pnl-calendar";

const week: PnlCalendarWeek = {
  startDate: "2026-08-03",
  endDate: "2026-08-07",
  pnl: 1_200,
  returnRate: 1.2,
  dataDayCount: 1,
};

const day: PnlCalendarDay = {
  date: "2026-08-03",
  pnl: 1_200,
  returnRate: 1.2,
  pricedHoldingCount: 1,
  totalHoldingCount: 1,
  coverageRate: 100,
  quality: "complete",
  isProvisional: false,
  contributions: [
    {
      holdingId: "holding-1",
      holdingIds: ["holding-1"],
      name: "台積電",
      symbol: "2330",
      assetType: "stock",
      market: "tse",
      pnl: 1_200,
      marketPnl: 1_200,
      tradePnl: 0,
      dividend: 0,
      fee: 0,
      tax: 0,
      previousPrice: 1_200,
      currentPrice: 1_210,
    },
  ],
};

describe("PnlWeekDetail", () => {
  it("keeps each day's holding detail collapsed by default", () => {
    const html = renderToStaticMarkup(
      createElement(PnlWeekDetail, {
        week,
        days: [day],
        transactions: [],
      })
    );

    expect(html).toMatch(
      /<details(?![^>]*\sopen(?:=|\s|>))[^>]*>.*<summary[^>]*>.*2026年8月3日.*<\/summary>.*台積電.*<\/details>/
    );
  });
});
