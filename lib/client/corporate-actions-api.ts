import type {
  CorporateActionEvent,
  CorporateActionLookupResponse,
} from "@/lib/corporate-actions/types";
import type { Holding } from "@/lib/types/holding";

export async function fetchCorporateActions(
  holdings: Holding[]
): Promise<CorporateActionLookupResponse> {
  const stockHoldings = holdings.filter((h) => h.assetType === "stock");
  const res = await fetch("/api/corporate-actions/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: stockHoldings.map((h) => ({
        holdingId: h.id,
        symbol: h.symbol,
        market: h.market ?? "tse",
        buyDate: h.buyDate,
      })),
    }),
  });

  const data = (await res.json()) as CorporateActionLookupResponse;
  if (!res.ok && data.success) {
    return {
      success: false,
      error: "公司行動查詢失敗",
      code: "UNKNOWN",
    };
  }
  return data;
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
