import type { PortfolioTransaction, SaleTransaction } from "@/lib/types/holding";

/** 先以成交 id 配對。舊備份以持倉、成交日和成交金額配對一次。 */
export function linkSaleEvents(sales: SaleTransaction[], transactions: PortfolioTransaction[]) {
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const events = transactions.filter((event) => event.type === "sell");
  const linked = new Map<string, SaleTransaction>();
  for (const event of events) {
    const sale = event.saleId ? saleById.get(event.saleId) : undefined;
    if (sale) {
      linked.set(event.id, sale);
      saleById.delete(sale.id);
    }
  }

  const salesByDay = new Map<string, SaleTransaction[]>();
  for (const sale of saleById.values()) {
    const key = `${sale.holdingId}:${sale.sellDate}`;
    const available = salesByDay.get(key) ?? [];
    available.push(sale);
    salesByDay.set(key, available);
  }
  for (const event of events) {
    if (event.saleId) continue;
    const candidates = salesByDay.get(`${event.holdingId}:${event.date}`) ?? [];
    const proceeds = (event.quantity ?? 0) * (event.price ?? 0);
    const matches = (sale: SaleTransaction) =>
      saleById.has(sale.id) && Math.abs(sale.proceeds - proceeds) < 0.01;
    const sale = candidates.find((record) =>
      matches(record) && record.fee === event.fee && record.tax === event.tax
    ) ?? candidates.find(matches);
    if (sale) {
      linked.set(event.id, sale);
      saleById.delete(sale.id);
    }
  }
  return { linked, unlinkedSales: [...saleById.values()] };
}
