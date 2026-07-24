import { normalizeToIsoDate } from "@/lib/date/iso-date";
import type { ChartRange } from "@/lib/portfolio/chart-date-range";
import { chartRangeToIsoDates } from "@/lib/portfolio/chart-date-range";

/** ISO YYYY-MM-DD → 集保 YYYY/MM/DD */
export function toFundclearDate(isoDate: string): string {
  if (isoDate.includes("/")) return isoDate;
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${y}/${m}/${d}`;
}

/** 集保 YYYY/MM/DD（或 YYYYMMDD）→ ISO YYYY-MM-DD */
export function fromFundclearDate(fundclearDate: string): string {
  return normalizeToIsoDate(fundclearDate) ?? fundclearDate.replace(/\//g, "-");
}

function isoToFundclear(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}/${m}/${d}`;
}

/**
 * 依圖表區間計算集保歷史淨值查詢的起訖日（YYYY/MM/DD）
 */
export function chartRangeToFundclearDates(
  range: ChartRange,
  options?: { buyDate?: string; maxAllDays?: number }
): { startDate: string; endDate: string } {
  const { startDate, endDate } = chartRangeToIsoDates(range, options);
  return {
    startDate: isoToFundclear(startDate),
    endDate: isoToFundclear(endDate),
  };
}
