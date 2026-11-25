import { normalizeToIsoDate, parseIsoDate } from "@/lib/date/iso-date";

type Check = (value: unknown) => boolean;
type Fields = Record<string, Check>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const string: Check = (value) => typeof value === "string";
const id: Check = (value) => typeof value === "string" && value.trim().length > 0 &&
  !Object.prototype.hasOwnProperty.call(Object.prototype, value);
const finite: Check = (value) => typeof value === "number" && Number.isFinite(value);
const nonnegative: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive: Check = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const date: Check = (value) => typeof value === "string" && !!parseIsoDate(value);
const compatibleDate: Check = (value) => typeof value === "string" && !!normalizeToIsoDate(value);
const isoTimestamp: Check = (value) => {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && value.length === 24 && new Date(time).toISOString() === value;
};
const idList: Check = (value) => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const boolean: Check = (value) => typeof value === "boolean";
const optional = (check: Check): Check => (value) => value === undefined || check(value);
const oneOf = (...allowed: string[]): Check => (value) => typeof value === "string" && allowed.includes(value);

const priceSource = oneOf("api", "manual");
const instrument = {
  name: string, symbol: string, market: optional(oneOf("tse", "otc")),
  assetType: oneOf("stock", "fund", "property"),
};
const holdingFields = {
  id, ...instrument, buyDate: compatibleDate, buyPrice: nonnegative, quantity: positive,
  currentPrice: optional(nonnegative), priceDate: optional(compatibleDate), priceSource: optional(priceSource),
  mortgageBalance: optional(nonnegative), leverageMultiplier: optional(positive),
  createdAt: string, updatedAt: string, positionUpdatedAt: optional(string),
  lastUpdatedAt: optional(string), lastError: optional(string),
};
const saleFields = {
  id, holdingId: id, ...instrument, buyDate: optional(date), sellDate: date,
  buyPrice: nonnegative, sellPrice: nonnegative, quantity: positive,
  costBasis: nonnegative, proceeds: nonnegative, realizedPnl: finite,
  fee: optional(nonnegative), tax: optional(nonnegative), positionClosed: optional(boolean),
  createdAt: string, updatedAt: optional(string),
};
const actionFields = {
  id, holdingId: id, ...instrument, effectiveDate: date, createdAt: string,
  actionType: oneOf("stock_dividend", "cash_dividend", "rights_issue", "mixed", "split",
    "reverse_split", "capital_reduction", "share_exchange", "manual_review"),
  source: oneOf("twse", "tpex", "manual"), sourceEventId: id,
  quantityBefore: nonnegative, quantityAfter: nonnegative,
  buyPriceBefore: nonnegative, buyPriceAfter: nonnegative,
  stockDividendRatio: optional(nonnegative), subscriptionRatio: optional(nonnegative),
  subscriptionPrice: optional(nonnegative), cashDividend: optional(nonnegative),
  adjustmentRatio: optional(positive), cashReturnPerShare: optional(nonnegative),
  totalCostBefore: optional(nonnegative), totalCostAfter: optional(nonnegative),
  priceHistoryAdjustedAt: optional(string), note: optional(string),
};
const transactionFields = {
  id, holdingId: id, ...instrument, assetType: oneOf("stock", "fund"),
  type: oneOf("buy", "sell", "opening_balance", "capital_return", "cash_dividend"), date,
  quantity: optional(nonnegative), price: optional(nonnegative), amount: optional(nonnegative),
  fee: nonnegative, tax: nonnegative, saleId: optional(id), corporateActionEventId: optional(id),
  settlementDate: optional(date), note: optional(string), createdAt: string, updatedAt: string,
  quality: oneOf("complete", "estimated", "legacy"), source: oneOf("user", "migration", "corporate_action"),
};
const dailySummaryFields = {
  date, pnl: finite, returnRate: (value: unknown) => value === null || finite(value),
  returnBase: optional(nonnegative), gapStartDate: optional(date), saleWithoutPriorPrice: optional(boolean),
  quality: oneOf("complete", "partial", "estimated", "provisional"), computedAt: string,
};
const pointFields = { date: compatibleDate, price: nonnegative, source: priceSource };

function invalidField(value: unknown, fields: Fields, path: string): string | undefined {
  if (!isRecord(value)) return path;
  for (const key in fields) {
    if (!fields[key](value[key])) return `${path}.${key}`;
  }
}

const loanHistoryFields = {
  balanceHistory: { effectiveDate: compatibleDate, balance: nonnegative, recordedAt: optional(string) },
  paymentHistory: { id, paymentDate: compatibleDate, principalPaid: nonnegative, interestPaid: nonnegative,
    feePaid: nonnegative, subsidyReceived: nonnegative, remainingPrincipalAfter: optional(nonnegative),
    installmentDueDate: optional(compatibleDate), interestPeriodStartDate: optional(compatibleDate),
    interestPeriodEndDate: optional(compatibleDate), note: optional(string), createdAt: optional(string) },
  rateHistory: { id, effectiveDate: compatibleDate, annualInterestRate: nonnegative, createdAt: optional(string) },
};

export function invalidLoanHistoryField(loan: unknown, path: string): string | undefined {
  if (!isRecord(loan)) return path;
  for (const [key, fields] of Object.entries(loanHistoryFields)) {
    const history = loan[key];
    if (history === undefined) continue;
    if (!Array.isArray(history)) return `${path}.${key}`;
    for (const [index, record] of history.entries()) {
      const invalid = invalidField(record, fields, `${path}.${key}[${index}]`);
      if (invalid) return invalid;
    }
  }
}

/** 檢查會直接交給持倉、損益與合併流程的資料，先回報第一筆無法使用的欄位。 */
export function invalidPortfolioField(raw: Record<string, unknown>): string | undefined {
  if (!Array.isArray(raw.holdings)) return "holdings";
  if (raw.holdingRemovals !== undefined) {
    if (!Array.isArray(raw.holdingRemovals)) return "holdingRemovals";
    const ids = new Set<string>();
    for (const [index, removal] of raw.holdingRemovals.entries()) {
      const path = `holdingRemovals[${index}]`;
      const invalid = invalidField(removal, { removedOn: date, removedAt: string }, path);
      if (invalid) return invalid;
      const invalidHolding = invalidField(removal.holding, holdingFields, `${path}.holding`);
      if (invalidHolding) return invalidHolding;
      if (ids.has(removal.holding.id)) return `${path}.holding.id（重複）`;
      ids.add(removal.holding.id);
    }
  }
  const collections = {
    holdings: holdingFields,
    sales: saleFields,
    saleImportReviews: { id, reviewedAt: isoTimestamp, includedIds: idList, excludedIds: idList },
    corporateActions: actionFields,
    transactions: transactionFields,
    transactionRevisions: { id, transactionId: id, correctedAt: string, previous: isRecord, reason: optional(string) },
    loanRevisions: { id, loanId: id, correctedAt: string, previous: isRecord },
  };

  for (const [key, fields] of Object.entries(collections)) {
    const records = raw[key];
    if (records === undefined) continue;
    if (!Array.isArray(records)) return key;
    const ids = new Set<string>();
    for (const [index, record] of records.entries()) {
      const path = `${key}[${index}]`;
      const invalid = invalidField(record, fields, path);
      if (invalid) return invalid;
      if (ids.has(record.id)) return `${path}.id（重複）`;
      ids.add(record.id);
      if (key === "saleImportReviews") {
        const included = new Set<string>(record.includedIds);
        if (record.excludedIds.some((saleId: string) => included.has(saleId))) return `${path}.excludedIds`;
        if (included.size + record.excludedIds.length === 0) return path;
      }
      if (key === "transactionRevisions") {
        const invalidPrevious = invalidField(record.previous, transactionFields, `${path}.previous`);
        if (invalidPrevious) return invalidPrevious;
      }
      if (key === "transactions") {
        const financialFields: Fields = record.type === "cash_dividend" || record.type === "capital_return"
          ? { amount: nonnegative } : { quantity: nonnegative, price: nonnegative };
        const invalidAmounts = invalidField(record, financialFields, path);
        if (invalidAmounts) return invalidAmounts;
      }
    }
  }

  if (raw.priceHistory !== undefined) {
    if (!isRecord(raw.priceHistory)) return "priceHistory";
    for (const [key, points] of Object.entries(raw.priceHistory)) {
      const path = `priceHistory[${JSON.stringify(key)}]`;
      if (!id(key) || !Array.isArray(points)) return path;
      for (const [index, point] of points.entries()) {
        const invalid = invalidField(point, pointFields, `${path}[${index}]`);
        if (invalid) return invalid;
      }
    }
  }

  if (raw.pnlTracking !== undefined) {
    if (!isRecord(raw.pnlTracking)) return "pnlTracking";
    if (raw.pnlTracking.startedAt !== undefined && raw.pnlTracking.startedAt !== "" && !date(raw.pnlTracking.startedAt))
      return "pnlTracking.startedAt";
    const summaries = raw.pnlTracking.dailySummaries;
    if (summaries !== undefined) {
      if (!isRecord(summaries)) return "pnlTracking.dailySummaries";
      for (const [key, summary] of Object.entries(summaries)) {
        const path = `pnlTracking.dailySummaries[${JSON.stringify(key)}]`;
        if (!date(key)) return path;
        const invalid = invalidField(summary, dailySummaryFields, path);
        if (invalid) return invalid;
      }
    }
  }

  if (raw.settings !== undefined) {
    return invalidField(raw.settings, {
      autoUpdateEnabled: optional(boolean), netAssets: optional(finite), liabilities: optional(nonnegative),
      allocationTargets: optional(isRecord), lastBatchUpdateAt: optional(string),
    }, "settings");
  }
}
