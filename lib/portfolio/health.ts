import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import type {
  HoldingWithMetrics,
  PriceHistoryMap,
} from "@/lib/types/holding";

export interface PortfolioHealthFactor {
  id: "concentration" | "diversification" | "priceData" | "history";
  label: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface PortfolioHealth {
  score: number;
  level: "excellent" | "good" | "watch" | "risk" | "empty";
  label: string;
  summary: string;
  factors: PortfolioHealthFactor[];
  suggestions: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return Infinity;
  return Math.floor((toTime - fromTime) / 86_400_000);
}

/**
 * 投資健康分數只衡量組合結構與資料品質，不把短期獲利視為健康。
 * 同一標的的多筆買入會先合併，避免拆單讓分散度被高估。
 */
export function computePortfolioHealth(
  holdings: HoldingWithMetrics[],
  priceHistory: PriceHistoryMap,
  asOfDate: string
): PortfolioHealth {
  const groups = groupHoldingsWithMetrics(holdings);
  const totalValue = groups.reduce((sum, group) => sum + group.marketValue, 0);

  if (groups.length === 0 || totalValue <= 0) {
    return {
      score: 0,
      level: "empty",
      label: "等待資料",
      summary: "新增持倉後，就能從配置與資料品質產生健康分數。",
      factors: [],
      suggestions: ["新增第一筆持倉，開始建立投資組合健康基準。"],
    };
  }

  const weights = groups.map((group) => group.marketValue / totalValue);
  const largestWeight = Math.max(...weights);
  const concentrationScore = Math.round(
    clamp(30 * (0.75 - largestWeight) / 0.5, 0, 30)
  );

  const assetTypeCount = new Set(groups.map((group) => group.assetType)).size;
  const instrumentScore = Math.min(15, Math.round((groups.length / 8) * 15));
  const assetTypeScore = Math.min(10, Math.round((assetTypeCount / 3) * 10));
  const diversificationScore = instrumentScore + assetTypeScore;

  let pricedValue = 0;
  let freshValue = 0;
  let historyValue = 0;
  for (const group of groups) {
    if (group.hasLivePrice) {
      pricedValue += group.marketValue;
      const age = group.priceDate
        ? daysBetween(group.priceDate, asOfDate)
        : Infinity;
      if (age >= 0 && age <= 7) freshValue += group.marketValue;
    }

    const hasHistory = group.lots.some(
      (lot) => (priceHistory[lot.id]?.length ?? 0) >= 2
    );
    if (hasHistory) historyValue += group.marketValue;
  }

  const priceCoverage = pricedValue / totalValue;
  const freshCoverage = freshValue / totalValue;
  const historyCoverage = historyValue / totalValue;
  const priceDataScore = Math.round(priceCoverage * 15 + freshCoverage * 10);
  const historyScore = Math.round(historyCoverage * 20);

  const factors: PortfolioHealthFactor[] = [
    {
      id: "concentration",
      label: "集中度",
      score: concentrationScore,
      maxScore: 30,
      detail: `最大標的占 ${(largestWeight * 100).toFixed(0)}%`,
    },
    {
      id: "diversification",
      label: "分散度",
      score: diversificationScore,
      maxScore: 25,
      detail: `${groups.length} 個標的、${assetTypeCount} 類資產`,
    },
    {
      id: "priceData",
      label: "行情完整度",
      score: priceDataScore,
      maxScore: 25,
      detail: `${Math.round(freshCoverage * 100)}% 市值有近期行情`,
    },
    {
      id: "history",
      label: "歷史資料",
      score: historyScore,
      maxScore: 20,
      detail: `${Math.round(historyCoverage * 100)}% 市值可追蹤趨勢`,
    },
  ];

  const score = factors.reduce((sum, factor) => sum + factor.score, 0);
  const suggestions: string[] = [];
  if (largestWeight > 0.4) {
    suggestions.push(`最大標的占比達 ${(largestWeight * 100).toFixed(0)}%，可評估降低單一標的風險。`);
  }
  if (groups.length < 5) {
    suggestions.push("標的數較少；可依自己的策略評估是否增加分散度。");
  }
  if (freshCoverage < 0.8) {
    suggestions.push("部分資產行情超過 7 天未更新，更新價格可提高判讀可信度。");
  }
  if (historyCoverage < 0.6) {
    suggestions.push("載入更多價格歷史，才能看出波動與長期趨勢。");
  }
  if (suggestions.length === 0) {
    suggestions.push("組合結構與資料品質穩定，持續定期更新即可。");
  }

  if (score >= 85) {
    return { score, level: "excellent", label: "狀態穩健", summary: "配置與資料品質都很完整。", factors, suggestions };
  }
  if (score >= 70) {
    return { score, level: "good", label: "整體良好", summary: "基礎穩定，仍有少數項目可以改善。", factors, suggestions };
  }
  if (score >= 50) {
    return { score, level: "watch", label: "值得留意", summary: "組合或資料完整度有明顯改善空間。", factors, suggestions };
  }
  return { score, level: "risk", label: "需要整理", summary: "集中風險或資料缺口偏高，建議逐項檢查。", factors, suggestions };
}
