import type { HoldingHistoryImportResult } from "@/lib/client/holding-history";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { Holding, PortfolioStorage } from "@/lib/types/holding";
import type { BatchUpdateItemResult } from "@/lib/types/price-api";
import { applyImportedPriceHistory, applyPriceUpdate, updateHolding } from "./portfolio-store";

export function isSamePriceTarget(current: Holding, requested: Holding): boolean {
  return current.id === requested.id &&
    current.createdAt === requested.createdAt &&
    holdingGroupKey(current) === holdingGroupKey(requested);
}

export function hasUnchangedQuote(current: Holding, requested: Holding): boolean {
  return current.lastUpdatedAt === requested.lastUpdatedAt &&
    current.priceDate === requested.priceDate &&
    current.currentPrice === requested.currentPrice &&
    current.priceSource === requested.priceSource;
}

export function applyQuoteResults(
  current: PortfolioStorage,
  requested: Holding[],
  results: BatchUpdateItemResult[],
) {
  const targets = new Map(requested.map((holding) => [holding.id, holding]));
  const holdings = new Map(current.holdings.map((holding) => [holding.id, holding]));
  let next = current;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    const original = targets.get(result.holdingId);
    const holding = holdings.get(result.holdingId);
    if (!original || !holding || !isSamePriceTarget(holding, original) ||
        !hasUnchangedQuote(holding, original) ||
        (result.data && holding.priceDate && result.data.priceDate < holding.priceDate)) {
      skipped++;
      continue;
    }

    if (result.ok && result.data) {
      const { price, priceDate, name, market } = result.data;
      next = applyPriceUpdate(next, holding.id, price, priceDate, "api", {
        name, market, clearError: true,
      });
      updated++;
    } else {
      next = updateHolding(next, holding.id, { lastError: result.error ?? "更新失敗" });
      failed++;
    }
  }

  return { next, updated, failed, skipped };
}

export function applyHistoryResults(
  current: PortfolioStorage,
  requested: Holding[],
  results: HoldingHistoryImportResult[],
) {
  const targets = new Map(requested.map((holding) => [holding.id, holding]));
  const holdings = new Map(current.holdings.map((holding) => [holding.id, holding]));
  const dates = new Set<string>();
  let next = current;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let error: string | undefined;

  for (const result of results) {
    const original = targets.get(result.holdingId);
    const holding = holdings.get(result.holdingId);
    if (!original || !holding || !isSamePriceTarget(holding, original)) {
      skipped++;
      continue;
    }

    if (result.ok && result.points.length > 0) {
      next = applyImportedPriceHistory(next, holding.id, result.points);
      for (const point of result.points) dates.add(point.date);
      updated++;
    } else {
      error = result.ok ? "所選區間沒有價格資料" : result.error;
      // 歷史請求失敗時，不蓋掉等待期間剛更新的行情狀態。
      if (hasUnchangedQuote(holding, original)) {
        next = updateHolding(next, holding.id, { lastError: error });
      }
      failed++;
    }
  }

  return { next, updated, failed, skipped, error, dates: [...dates].sort() };
}
