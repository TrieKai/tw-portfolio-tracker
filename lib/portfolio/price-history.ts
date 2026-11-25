import { corporateActionAdjustmentRatio, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { todayIsoDate } from "@/lib/date/iso-date";
import { holdingGroupKey, type HoldingSymbolGroup } from "@/lib/portfolio/holding-groups";
import type { CorporateActionRecord, Holding, PriceHistoryMap, PricePoint } from "@/lib/types/holding";

/** 各批行情以各自已登錄的公司行動儲存，合併前先換成標的在查看日的共用股數基準。 */
export function buildInstrumentPriceHistory(
  group: HoldingSymbolGroup,
  priceHistory: PriceHistoryMap,
  corporateActions: CorporateActionRecord[],
  asOfDate = todayIsoDate()
) {
  const actionsByHolding = new Map<string, CorporateActionRecord[]>();
  const instrumentActions = new Map<string, CorporateActionRecord>();
  let lastShareChange: string | undefined;
  for (const action of corporateActions) {
    const ratio = corporateActionAdjustmentRatio(action);
    if (ratio === 1 || holdingGroupKey({ ...action, id: action.holdingId }) !== group.groupKey) continue;
    const applied = actionsByHolding.get(action.holdingId) ?? [];
    applied.push(action);
    actionsByHolding.set(action.holdingId, applied);
    if (action.effectiveDate > asOfDate) continue;
    // 同一次異動會在各批各有一筆紀錄，標的價格只換算一次。
    const key = JSON.stringify([action.effectiveDate, action.actionType, ratio]);
    instrumentActions.set(key, action);
    if (!lastShareChange || action.effectiveDate > lastShareChange) lastShareChange = action.effectiveDate;
  }

  const basisActions = [...instrumentActions.values()];
  const byDate = new Map<string, PricePoint>();
  for (const lot of group.lots) {
    const lotActions = actionsByHolding.get(lot.id) ?? [];
    for (const point of priceHistory[lot.id] ?? []) {
      if (point.date > asOfDate || byDate.has(point.date)) continue;
      const factor = shareAdjustmentAfter(lotActions, point.date) / shareAdjustmentAfter(basisActions, point.date);
      byDate.set(point.date, factor === 1 ? point : { ...point, price: point.price * factor });
    }
  }

  return { points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), lastShareChange };
}

/** 舊版回填可能把較早的價格設為現價，已保留的新日期可以直接修復。 */
export function restoreLatestQuote(holding: Holding, history: PricePoint[] = []): Holding {
  const latest = history.at(-1);
  if (!holding.priceDate || !latest || latest.date <= holding.priceDate) return holding;
  return { ...holding, currentPrice: latest.price, priceDate: latest.date, priceSource: latest.source };
}

export function pnlDatesUsingChangedPrices(
  points: PricePoint[],
  changedDates: ReadonlySet<string>,
  eventDates: string[]
): Set<string> {
  const affected = new Set<string>();
  // 一筆行情也會成為下一個估值日，以及兩個估值日之間成交與配息的比較基準。
  for (const [index, point] of points.entries()) {
    if (!changedDates.has(point.date)) continue;
    affected.add(point.date);
    const nextDate = points[index + 1]?.date;
    if (nextDate) affected.add(nextDate);
    for (const date of eventDates) {
      if (date > point.date && (!nextDate || date <= nextDate)) affected.add(date);
    }
  }
  return affected;
}
