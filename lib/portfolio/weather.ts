import { formatCurrency } from "@/lib/portfolio/calculations";
import type { PeriodPnlBreakdown } from "@/lib/portfolio/pnl-breakdown";
import type { PortfolioSummary } from "@/lib/types/holding";

export type InvestmentWeatherKind =
  | "sunny"
  | "partlyCloudy"
  | "cloudy"
  | "rainy"
  | "storm"
  | "unknown"
  | "empty";

export interface InvestmentWeather {
  kind: InvestmentWeatherKind;
  icon: string;
  title: string;
  summary: string;
  changeRate: number | null;
  note?: string;
}

/** 將當日整體市值變動轉成容易掃讀的天氣，不預測未來走勢。 */
export function computeInvestmentWeather(
  summary: PortfolioSummary,
  dailyBreakdown: PeriodPnlBreakdown | null
): InvestmentWeather {
  if (summary.holdingCount === 0) {
    return {
      kind: "empty",
      icon: "🌱",
      title: "等待第一筆持倉",
      summary: "新增資產後，這裡會用天氣快速描述每日變化。",
      changeRate: null,
    };
  }

  if (summary.dailyUnrealizedPnl === null) {
    return {
      kind: "unknown",
      icon: "🌫️",
      title: "今日能見度不足",
      summary: "更新行情並累積至少兩個交易日資料後，就能產生投資天氣。",
      changeRate: null,
      note: summary.hasStaleFundNavOnDaily ? "部分基金淨值尚未更新" : undefined,
    };
  }

  const previousValue = summary.totalValue - summary.dailyUnrealizedPnl;
  const changeRate = previousValue > 0
    ? (summary.dailyUnrealizedPnl / previousValue) * 100
    : 0;
  const dominant = dailyBreakdown?.byHolding[0];
  const direction = summary.dailyUnrealizedPnl >= 0 ? "增加" : "減少";
  const driver = dominant
    ? `，主要受${dominant.name || dominant.symbol}影響`
    : "";
  const summaryText = `今日資產約${direction} ${formatCurrency(Math.abs(summary.dailyUnrealizedPnl))}${driver}。`;

  const base = changeRate >= 0.75
    ? { kind: "sunny" as const, icon: "☀️", title: "今日晴朗" }
    : changeRate >= 0.15
      ? { kind: "partlyCloudy" as const, icon: "🌤️", title: "陽光露臉" }
      : changeRate > -0.15
        ? { kind: "cloudy" as const, icon: "☁️", title: "今日多雲" }
        : changeRate > -0.75
          ? { kind: "rainy" as const, icon: "🌦️", title: "局部陣雨" }
          : { kind: "storm" as const, icon: "⛈️", title: "風雨偏強" };

  return {
    ...base,
    summary: summaryText,
    changeRate,
    note: summary.hasStaleFundNavOnDaily ? "基金淨值可能不是今日資料" : "天氣描述當日變動，不代表未來走勢",
  };
}
