import { addDaysToIsoDate, toIsoDate } from "@/lib/date/iso-date";

export interface TradingCalendarRow {
  weekStartDate: string;
  weekEndDate: string;
  /** 週一至週五；不屬於所選月份的位置為 null。 */
  dates: Array<string | null>;
}

/** 建立只顯示週一至週五的月份格線，不把週末事件移到其他日期。 */
export function buildTradingCalendarGrid(month: string): TradingCalendarRow[] {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) return [];

  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const rows = new Map<string, TradingCalendarRow>();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthNumber - 1, day);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const iso = toIsoDate(date);
    const monday = toIsoDate(
      new Date(year, monthNumber - 1, day - (dayOfWeek - 1))
    );
    const row = rows.get(monday) ?? {
      weekStartDate: monday,
      weekEndDate: addDaysToIsoDate(monday, 4),
      dates: [null, null, null, null, null],
    };
    row.dates[dayOfWeek - 1] = iso;
    rows.set(monday, row);
  }

  return Array.from(rows.values()).sort((a, b) =>
    a.weekStartDate.localeCompare(b.weekStartDate)
  );
}
