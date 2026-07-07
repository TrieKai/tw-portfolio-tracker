import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import type {
  CorporateActionEvent,
  CorporateActionLookupItem,
} from "@/lib/corporate-actions/types";
import type { StockMarket } from "@/lib/types/holding";

const TWSE_EX_RIGHTS_URL =
  "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL";
const TPEX_EX_RIGHTS_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost";

interface TwseExRightsRow {
  Date?: string;
  Code?: string;
  Name?: string;
  Exdividend?: string;
  StockDividendRatio?: string;
  SubscriptionRatio?: string;
  SubscriptionPricePerShare?: string;
  CashDividend?: string;
}

interface TpexExRightsRow {
  ExRrightsExDividendDate?: string;
  SecuritiesCompanyCode?: string;
  CompanyName?: string;
  ExRrightsExDividend?: string;
  StockDividendRatio?: string;
  SubscriptionRatioToNewSharesIssued?: string;
  SubscriptionPricePerShare?: string;
  CashDividend?: string;
}

function parseRocDate(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length !== 7) return null;
  const year = Number(digits.slice(0, 3)) + 1911;
  const month = digits.slice(3, 5);
  const day = digits.slice(5, 7);
  return `${year}-${month}-${day}`;
}

function parseNumber(raw: string | undefined): number | undefined {
  const normalized = (raw ?? "").replace(/,/g, "").trim();
  if (!normalized || /待|尚未|註|N\/A/i.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function classifyAction(
  label: string,
  stockDividendRatio: number,
  subscriptionRatio: number,
  cashDividend?: number
): CorporateActionEvent["type"] {
  if (stockDividendRatio > 0 && (cashDividend ?? 0) > 0) return "mixed";
  if (stockDividendRatio > 0) return "stock_dividend";
  if (subscriptionRatio > 0) return "rights_issue";
  if (label.includes("息") || (cashDividend ?? 0) > 0) return "cash_dividend";
  return "manual_review";
}

function eventId(
  source: "twse" | "tpex",
  market: StockMarket,
  symbol: string,
  effectiveDate: string
): string {
  return `${source}:${market}:${symbol}:${effectiveDate}`;
}

function normalizeTwseRow(row: TwseExRightsRow): Omit<CorporateActionEvent, "holdingId"> | null {
  const symbol = row.Code?.trim();
  const effectiveDate = parseRocDate(row.Date);
  if (!symbol || !effectiveDate) return null;

  const stockDividendRatio = parseNumber(row.StockDividendRatio) ?? 0;
  const subscriptionRatio = parseNumber(row.SubscriptionRatio) ?? 0;
  const cashDividend = parseNumber(row.CashDividend);
  const label = row.Exdividend?.trim() ?? "";
  const type = classifyAction(label, stockDividendRatio, subscriptionRatio, cashDividend);

  return {
    id: eventId("twse", "tse", symbol, effectiveDate),
    symbol,
    market: "tse",
    name: row.Name?.trim() || symbol,
    type,
    effectiveDate,
    source: "twse",
    exDividendLabel: label,
    stockDividendRatio,
    subscriptionRatio,
    subscriptionPrice: parseNumber(row.SubscriptionPricePerShare),
    cashDividend,
    autoApplicable: stockDividendRatio > 0,
    note:
      subscriptionRatio > 0
        ? "含現金增資配股，實際認購與否需確認。"
        : undefined,
  };
}

function normalizeTpexRow(row: TpexExRightsRow): Omit<CorporateActionEvent, "holdingId"> | null {
  const symbol = row.SecuritiesCompanyCode?.trim();
  const effectiveDate = parseRocDate(row.ExRrightsExDividendDate);
  if (!symbol || !effectiveDate) return null;

  const stockDividendRatio = parseNumber(row.StockDividendRatio) ?? 0;
  const subscriptionRatio =
    parseNumber(row.SubscriptionRatioToNewSharesIssued) ?? 0;
  const cashDividend = parseNumber(row.CashDividend);
  const label = row.ExRrightsExDividend?.trim() ?? "";
  const type = classifyAction(label, stockDividendRatio, subscriptionRatio, cashDividend);

  return {
    id: eventId("tpex", "otc", symbol, effectiveDate),
    symbol,
    market: "otc",
    name: row.CompanyName?.trim() || symbol,
    type,
    effectiveDate,
    source: "tpex",
    exDividendLabel: label,
    stockDividendRatio,
    subscriptionRatio,
    subscriptionPrice: parseNumber(row.SubscriptionPricePerShare),
    cashDividend,
    autoApplicable: stockDividendRatio > 0,
    note:
      subscriptionRatio > 0
        ? "含現金增資配股，實際認購與否需確認。"
        : undefined,
  };
}

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetchWithRetry(url, {
    timeoutMs: 8_000,
    maxRetries: 3,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function lookupCorporateActions(
  items: CorporateActionLookupItem[]
): Promise<CorporateActionEvent[]> {
  const stockItems = items.filter((item) => item.symbol.trim());
  if (stockItems.length === 0) return [];

  const neededMarkets = new Set(stockItems.map((item) => item.market ?? "tse"));
  const [twseRows, tpexRows] = await Promise.all([
    neededMarkets.has("tse")
      ? fetchJson<TwseExRightsRow>(TWSE_EX_RIGHTS_URL)
      : Promise.resolve([]),
    neededMarkets.has("otc")
      ? fetchJson<TpexExRightsRow>(TPEX_EX_RIGHTS_URL)
      : Promise.resolve([]),
  ]);

  const allEvents = [
    ...twseRows.map(normalizeTwseRow),
    ...tpexRows.map(normalizeTpexRow),
  ].filter((event): event is Omit<CorporateActionEvent, "holdingId"> => !!event);

  const eventsByKey = new Map<string, Omit<CorporateActionEvent, "holdingId">[]>();
  for (const event of allEvents) {
    const key = `${event.market}:${event.symbol}`;
    eventsByKey.set(key, [...(eventsByKey.get(key) ?? []), event]);
  }

  return stockItems.flatMap((item) => {
    const market = item.market ?? "tse";
    const events = eventsByKey.get(`${market}:${item.symbol}`) ?? [];
    return events
      .filter((event) => event.effectiveDate > item.buyDate)
      .map((event) => ({ ...event, holdingId: item.holdingId }));
  });
}
