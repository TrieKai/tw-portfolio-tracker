import React from "react";
import { AmountPrivacyProvider } from "@/providers/AmountPrivacyProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CalendarGrid, PnlCalendarPage, calendarHistoryRange } from "@/components/calendar/PnlCalendarPage";
import type { TradingCalendarRow } from "@/lib/date/trading-calendar";
import type { PnlCalendarResult } from "@/lib/portfolio/pnl-calendar";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import { addLoan } from "@/lib/storage/loan-store";

const { usePortfolio } = vi.hoisted(() => ({ usePortfolio: vi.fn() }));
vi.mock("@/providers/PortfolioProvider", () => ({ usePortfolio }));

describe("PnlCalendarPage without current holdings", () => {
  it("shows recorded investment financing costs without a stock or fund", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const storage = addLoan(defaultPortfolioStorage(), { name: "投資借款", loanType: "revolving_credit",
        purpose: "investment", investmentUsePercent: 100, rateType: "floating", repaymentMethod: "revolving",
        openingBalance: 120_000, annualInterestRate: 3.65, trackingStartDate: "2026-11-01", dataQuality: "complete" });
      usePortfolio.mockReturnValue({ storage, holdings: [], ready: true, batchStatus: "idle" });
      const html = renderToStaticMarkup(<AmountPrivacyProvider><PnlCalendarPage /></AmountPrivacyProvider>);
      expect(html).toContain("融資成本影響");
      expect(html).toContain("−$288");
      expect(html).toContain('aria-label="交易週日曆"');
      expect(html).not.toContain("尚無股票或基金");
      expect(html).not.toContain('aria-label="篩選資產"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the saved investment total from a backup with no holding records", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
      const storage = defaultPortfolioStorage();
      storage.pnlTracking.dailySummaries["2026-11-04"] = {
        date: "2026-11-04", pnl: 625, returnRate: null, quality: "complete", computedAt: "2026-11-04T09:00:00.000Z",
      };
      usePortfolio.mockReturnValue({ storage, holdings: [], ready: true, batchStatus: "idle" });
      const html = renderToStaticMarkup(<AmountPrivacyProvider><PnlCalendarPage /></AmountPrivacyProvider>);
      expect(html).toContain("+$625");
      expect(html).toContain("2026-11-04，損益");
      expect(html).not.toContain("尚無股票或基金");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CalendarGrid", () => {
  it("補齊所選月份和前一個月的估值基準", () => {
    expect(calendarHistoryRange("2024-02", "2026-11-25")).toEqual({
      startDate: "2024-01-01", endDate: "2024-02-29",
    });
    expect(calendarHistoryRange("2026-11", "2026-11-25")).toEqual({
      startDate: "2026-10-01", endDate: "2026-11-25",
    });
  });

  it("renders each mobile week summary before that week's trading days", () => {
    const rows: TradingCalendarRow[] = [
      {
        weekStartDate: "2026-08-03",
        weekEndDate: "2026-08-07",
        dates: ["2026-08-03", null, null, null, null],
      },
    ];
    const calendar: PnlCalendarResult = {
      month: "2026-08",
      days: [
        {
          date: "2026-08-03",
          pnl: 100,
          returnRate: 1,
          pricedHoldingCount: 1,
          totalHoldingCount: 1,
          coverageRate: 100,
          quality: "complete",
          isProvisional: false,
          contributions: [],
        },
      ],
      weeks: [
        {
          startDate: "2026-08-03",
          endDate: "2026-08-07",
          pnl: 100,
          returnRate: 1,
          dataDayCount: 1,
        },
      ],
      summary: {
        pnl: 100,
        returnRate: 1,
        gainDayCount: 1,
        lossDayCount: 0,
        flatDayCount: 0,
        dataDayCount: 1,
        completeDayCount: 1,
      },
    };

    const html = renderToStaticMarkup(
      <AmountPrivacyProvider>
        <CalendarGrid
          rows={rows}
          calendar={calendar}
          weekendEvents={new Map()}
          onSelectDay={() => undefined}
          onSelectWeek={() => undefined}
        />
      </AmountPrivacyProvider>
    );

    expect(html.indexOf("第 1 週損益")).toBeLessThan(
      html.indexOf("2026-08-03，損益")
    );
  });
});
