import type { PersistedPnlDaySummary, PortfolioTransaction } from "@/lib/types/holding";

export function hasNewerTradeOnSummaryDate(transactions: PortfolioTransaction[], summary: PersistedPnlDaySummary): boolean {
  return transactions.some((event) => event.date === summary.date &&
    (event.type === "buy" || event.type === "sell") && event.updatedAt > summary.computedAt);
}

export function dividendPnlByDate(transactions: PortfolioTransaction[]) {
  const result = new Map<string, Map<string, number>>();
  for (const event of transactions) {
    const amount = event.amount ?? 0;
    if (event.type !== "cash_dividend" || !Number.isFinite(amount) || amount <= 0) continue;
    const amounts = result.get(event.date) ?? new Map<string, number>();
    amounts.set(event.holdingId, (amounts.get(event.holdingId) ?? 0) + amount - event.fee - event.tax);
    result.set(event.date, amounts);
  }
  return result;
}

export function dividendPnlChange(before?: ReadonlyMap<string, number>, after?: ReadonlyMap<string, number>) {
  let delta = 0;
  let basisChanged = (before?.size ?? 0) !== (after?.size ?? 0);
  for (const [id, amount] of before ?? []) {
    delta += (after?.get(id) ?? 0) - amount;
    if (!after?.has(id)) basisChanged = true;
  }
  for (const [id, amount] of after ?? []) if (!before?.has(id)) delta += amount;
  return { delta, basisChanged };
}

export function applyDividendPnlChange(
  summary: PersistedPnlDaySummary,
  { delta, basisChanged }: ReturnType<typeof dividendPnlChange>,
  computedAt: string
): PersistedPnlDaySummary {
  if (!delta && !basisChanged) return summary;
  const pnl = summary.pnl + delta;
  // 增減入帳批次時，已無行情可確定它是否原本已列入當天的報酬基準。
  const returnBase = basisChanged ? undefined : summary.returnBase;
  const returnRate = returnBase && summary.returnRate !== null ? (pnl / returnBase) * 100 : null;
  return { ...summary, pnl, returnBase, returnRate, quality: basisChanged ? "estimated" : summary.quality, computedAt };
}
