import {
  buildPortfolioTimelineBetween,
  getEffectiveHistory,
} from "@/lib/portfolio/portfolio-timeline";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";

export interface LatestDailyValuation {
  startDate: string;
  endDate: string;
  pnlChange: number;
  /** 結束日早於查詢日，可能是休市、週末或行情尚未更新。 */
  usesPreviousDate: boolean;
}

/**
 * 取得最近兩個實際存在的組合估值日，不用日曆猜測交易日。
 * 因此週末、國定假日與臨時颱風休市都會自然沿用最近行情。
 */
export function getLatestDailyValuation(
  holdings: Holding[],
  priceHistory: PriceHistoryMap,
  asOfDate: string
): LatestDailyValuation | null {
  if (holdings.length === 0) return null;

  const quoteDates = new Set(
    holdings.flatMap((holding) =>
      getEffectiveHistory(holding, priceHistory)
        .filter((point) => point.date <= asOfDate)
        .map((point) => point.date)
    )
  );
  const points = buildPortfolioTimelineBetween(
    holdings,
    priceHistory,
    "0000-01-01",
    asOfDate
  ).filter((point) => quoteDates.has(point.date));
  if (points.length < 2) return null;

  const end = points[points.length - 1];
  const start = points[points.length - 2];
  return {
    startDate: start.date,
    endDate: end.date,
    pnlChange: end.pnl - start.pnl,
    usesPreviousDate: end.date < asOfDate,
  };
}
