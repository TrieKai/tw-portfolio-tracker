import { holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { CorporateActionRecord, PortfolioStorage, SaleTransaction } from "@/lib/types/holding";

function saleTerms(sale: SaleTransaction) {
  return JSON.stringify([sale.holdingId, holdingGroupKey({ ...sale, id: sale.holdingId }), sale.buyDate,
    sale.sellDate, sale.quantity, sale.sellPrice, sale.realizedPnl, sale.fee ?? 0, sale.tax ?? 0]);
}

function summariesMatchingSales(
  source: PortfolioStorage,
  chosenSales: SaleTransaction[],
  actions: CorporateActionRecord[]
) {
  const summaries = source.pnlTracking.dailySummaries;
  const sourceTerms = new Map(source.sales.map((sale) => [sale.id, saleTerms(sale)]));
  const chosenTerms = new Map(chosenSales.map((sale) => [sale.id, saleTerms(sale)]));
  const changesByDate = new Map<string, Map<string, number>>();
  const addChange = (sale: SaleTransaction, sign: number) => {
    if (sale.assetType === "property") return;
    const day = changesByDate.get(sale.sellDate) ?? new Map<string, number>();
    const basis = holdingActions(actions, { ...sale, id: sale.holdingId });
    const shares = sale.quantity * shareAdjustmentAfter(basis, sale.sellDate);
    day.set(sale.holdingId, (day.get(sale.holdingId) ?? 0) + shares * sign);
    changesByDate.set(sale.sellDate, day);
  };
  for (const sale of source.sales) {
    if (sourceTerms.get(sale.id) !== chosenTerms.get(sale.id)) addChange(sale, -1);
  }
  for (const sale of chosenSales) {
    if (chosenTerms.get(sale.id) !== sourceTerms.get(sale.id)) addChange(sale, 1);
  }
  if (!changesByDate.size) return summaries;

  // 成交日的費稅及價差可能不同。之後則在庫存股數相同時才能沿用該來源的摘要。
  const changes = [...changesByDate].sort(([a], [b]) => a.localeCompare(b));
  const shareDifferences = new Map<string, number>();
  const accepted: typeof summaries = {};
  let cursor = 0;
  for (const date of Object.keys(summaries).sort()) {
    while (cursor < changes.length && changes[cursor][0] <= date) {
      for (const [id, delta] of changes[cursor][1]) {
        const previous = shareDifferences.get(id) ?? 0;
        const sum = previous + delta;
        if (Math.abs(sum) <= 8 * Number.EPSILON * Math.max(Math.abs(previous), Math.abs(delta))) {
          shareDifferences.delete(id);
        } else {
          shareDifferences.set(id, sum);
        }
      }
      cursor += 1;
    }
    if (!changesByDate.has(date) && !shareDifferences.size) accepted[date] = summaries[date];
  }
  return accepted;
}

export function mergeDailyPnlSummaries(
  current: PortfolioStorage,
  incoming: PortfolioStorage,
  sales: SaleTransaction[],
  actions: CorporateActionRecord[],
  changedPrices: { current: ReadonlySet<string>; incoming: ReadonlySet<string> }
): PortfolioStorage["pnlTracking"]["dailySummaries"] {
  const summaries = Object.fromEntries(Object.entries(summariesMatchingSales(current, sales, actions))
    .filter(([date]) => !changedPrices.current.has(date)));
  const earliest = priceHistoryStartDate();
  for (const [date, summary] of Object.entries(summariesMatchingSales(incoming, sales, actions))) {
    if (changedPrices.incoming.has(date)) continue;
    // 行情明細過期後，只能補入缺少的摘要；產生時間較新不代表採用了相同價格。
    if (!summaries[date] || (date >= earliest && summary.computedAt > summaries[date].computedAt)) {
      summaries[date] = summary;
    }
  }
  return summaries;
}
