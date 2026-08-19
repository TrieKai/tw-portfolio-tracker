import { describe, expect, it } from "vitest";
import { buildTradingCalendarGrid } from "@/lib/date/trading-calendar";

describe("buildTradingCalendarGrid", () => {
  it("builds Monday-to-Friday rows with empty trailing cells", () => {
    const rows = buildTradingCalendarGrid("2026-06");

    expect(rows).toMatchObject([
      { dates: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"] },
      {},
      {},
      {},
      { dates: ["2026-06-29", "2026-06-30", null, null, null] },
    ]);
  });
});
