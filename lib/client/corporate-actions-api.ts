import {
  MAX_CORPORATE_ACTION_LOOKUP_ITEMS,
  type CorporateActionEvent,
  type CorporateActionLookupItem,
  type CorporateActionLookupResponse,
} from "@/lib/corporate-actions/types";
import { normalizeStockSymbol } from "@/lib/prices/stock-symbol";

export async function fetchCorporateActions(
  items: CorporateActionLookupItem[]
): Promise<CorporateActionLookupResponse> {
  const bySymbol = new Map<string, CorporateActionLookupItem[]>();
  for (const item of items) {
    const key = `${item.market ?? "tse"}:${normalizeStockSymbol(item.symbol)}`;
    const lots = bySymbol.get(key) ?? [];
    lots.push(item);
    bySymbol.set(key, lots);
  }
  const representatives = [...bySymbol.values()].map((lots) =>
    lots.reduce((earliest, lot) => lot.buyDate < earliest.buyDate ? lot : earliest)
  );
  const lotsByRepresentative = new Map(representatives.map((item) =>
    [item.holdingId, bySymbol.get(`${item.market ?? "tse"}:${normalizeStockSymbol(item.symbol)}`)!]
  ));
  const events: CorporateActionEvent[] = [];
  let updatedAt = new Date().toISOString();
  for (let offset = 0; offset < representatives.length; offset += MAX_CORPORATE_ACTION_LOOKUP_ITEMS) {
    const res = await fetch("/api/corporate-actions/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: representatives.slice(offset, offset + MAX_CORPORATE_ACTION_LOOKUP_ITEMS) }),
    });
    const data = (await res.json()) as CorporateActionLookupResponse;
    if (!data.success) return data;
    if (!res.ok) return { success: false, error: "公司行動查詢失敗", code: "UNKNOWN" };
    events.push(...data.events.flatMap((event) =>
      (lotsByRepresentative.get(event.holdingId) ?? []).map((lot) => ({ ...event, holdingId: lot.holdingId }))
    ));
    updatedAt = data.updatedAt;
  }
  return { success: true, events, updatedAt };
}

export function corporateActionLabel(event: CorporateActionEvent): string {
  switch (event.type) {
    case "stock_dividend":
      return "股票股利";
    case "cash_dividend":
      return "現金股利";
    case "rights_issue":
      return "現金增資";
    case "mixed":
      return "權息";
    case "manual_review":
      return "需確認";
  }
}
