import React from "react";
import { AmountPrivacyProvider } from "@/providers/AmountPrivacyProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PnlWeekDetail } from "@/components/calendar/PnlDetailPanel";
import type { PnlCalendarDay, PnlCalendarWeek } from "@/lib/portfolio/pnl-calendar";
import type { PortfolioTransaction } from "@/lib/types/holding";

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
      <AmountPrivacyProvider>
        <PnlWeekDetail
          week={week}
          days={[day]}
          transactions={[]}
        />
      </AmountPrivacyProvider>
    );

    expect(html).toMatch(
      /<details(?![^>]*\sopen(?:=|\s|>))[^>]*>.*<summary[^>]*>.*2026年8月3日.*<\/summary>.*台積電.*<\/details>/
    );
  });

  it("shows recorded payments alongside the archived total", () => {
    const dividend: PortfolioTransaction = {
      id: "one-dividend", type: "cash_dividend", holdingId: "holding-1", name: "台積電", symbol: "2330",
      assetType: "stock", date: day.date, amount: 75, settlementDate: "2026-08-20", fee: 0, tax: 0,
      quality: "complete", source: "user", createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
    };
    const html = renderToStaticMarkup(<AmountPrivacyProvider>
      <PnlWeekDetail week={week} days={[{ ...day, contributions: [] }]} transactions={[dividend]} />
    </AmountPrivacyProvider>);
    expect(html).toContain("日損益總額已保存");
    expect(html).toContain('aria-label="當日配息"');
    expect(html).toContain("實際入帳 2026-08-20");
    expect(html).toContain("$75");
  });
});
