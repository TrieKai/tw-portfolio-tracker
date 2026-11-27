import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import type { PortfolioStorage } from "@/lib/types/holding";

export function persistPnlSummariesForDates(
  state: PortfolioStorage,
  dates: string[],
  computedAt = new Date().toISOString()
): PortfolioStorage {
  const dateSet = new Set(dates);
  const endByMonth = new Map<string, string>();
  for (const date of dateSet) {
    const month = date.slice(0, 7);
    const existing = endByMonth.get(month);
    if (!existing || date > existing) endByMonth.set(month, date);
  }
  if (endByMonth.size === 0) return state;

  const dailySummaries = { ...state.pnlTracking.dailySummaries };
  for (const [month, asOfDate] of endByMonth) {
    const calendar = buildPnlCalendar(state, {
      month,
      asOfDate,
      filter: { kind: "investment" },
    });
    for (const day of calendar.days) {
      if (!dateSet.has(day.date)) continue;
      dailySummaries[day.date] = {
        date: day.date,
        pnl: day.pnl,
        returnRate: day.returnRate,
        returnBase: day.returnBase,
        gapStartDate: day.gapStartDate,
        saleWithoutPriorPrice: day.saleWithoutPriorPrice,
        quality: day.quality,
        computedAt,
      };
    }
  }
  return {
    ...state,
    pnlTracking: {
      ...state.pnlTracking,
      dailySummaries,
    },
  };
}
