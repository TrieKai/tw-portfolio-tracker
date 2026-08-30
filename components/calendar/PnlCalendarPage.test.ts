import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarGrid } from "@/components/calendar/PnlCalendarPage";
import type { TradingCalendarRow } from "@/lib/date/trading-calendar";
import type { PnlCalendarResult } from "@/lib/portfolio/pnl-calendar";

describe("CalendarGrid", () => {
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
      createElement(CalendarGrid, {
        rows,
        calendar,
        weekendEvents: new Map(),
        onSelectDay: () => undefined,
        onSelectWeek: () => undefined,
      })
    );

    expect(html.indexOf("第 1 週損益")).toBeLessThan(
      html.indexOf("2026-08-03，損益")
    );
  });
});
