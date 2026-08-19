/**
 * 投資組合儲存（LocalStorage）
 * 匿名模式僅寫入本機；登入 Google 時另由 API 同步至雲端，本機仍作快取。
 */

import { PORTFOLIO_STORAGE_KEY, MAX_PRICE_HISTORY_DAYS } from "@/lib/portfolio/constants";
import { normalizeToIsoDate } from "@/lib/date/iso-date";
import {
  defaultPortfolioStorage,
  normalizePortfolioStorage,
} from "@/lib/storage/parse-portfolio";
import { normalizeStockSymbol } from "@/lib/prices/stock-symbol";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import type {
  CorporateActionRecord,
  CashDividendInput,
  CreateHoldingInput,
  EditHoldingInput,
  Holding,
  ManualCorporateActionInput,
  PortfolioSettings,
  PortfolioStorage,
  PriceHistoryMap,
  PricePoint,
  PriceSource,
  SaleTransaction,
  SellHoldingInput,
  StockMarket,
} from "@/lib/types/holding";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";

export function loadPortfolio(): PortfolioStorage {
  if (typeof window === "undefined") return defaultPortfolioStorage();

  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return defaultPortfolioStorage();
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePortfolioStorage(parsed) ?? defaultPortfolioStorage();
    const repaired = repairCorporateActionPriceHistory(normalized);
    if (repaired !== normalized) savePortfolio(repaired);
    return repaired;
  } catch {
    return defaultPortfolioStorage();
  }
}

export function savePortfolio(state: PortfolioStorage): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(state));
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function persistPnlSummariesForDates(
  state: PortfolioStorage,
  dates: string[]
): PortfolioStorage {
  const dateSet = new Set(dates);
  const endByMonth = new Map<string, string>();
  for (const date of dateSet) {
    const month = date.slice(0, 7);
    const existing = endByMonth.get(month);
    if (!existing || date > existing) endByMonth.set(month, date);
  }
  if (endByMonth.size === 0) return state;

  const dailySummaries = { ...state.pnlTracking.dailySummaries };
  const computedAt = new Date().toISOString();
  for (const [month, asOfDate] of endByMonth) {
    const calendar = buildPnlCalendar(state, {
      month,
      asOfDate,
      filter: { kind: "investment" },
    });
    for (const day of calendar.days) {
      if (!dateSet.has(day.date)) continue;
      dailySummaries[day.date] = {
        date: day.date,
        pnl: day.pnl,
        returnRate: day.returnRate,
        quality: day.quality,
        computedAt,
      };
    }
  }
  return {
    ...state,
    pnlTracking: {
      ...state.pnlTracking,
      dailySummaries,
    },
  };
}

function hasHandledCorporateAction(
  state: PortfolioStorage,
  holdingId: string,
  sourceEventId: string
): boolean {
  return state.corporateActions.some(
    (a) => a.holdingId === holdingId && a.sourceEventId === sourceEventId
  );
}

export function addHolding(
  state: PortfolioStorage,
  input: CreateHoldingInput
): PortfolioStorage {
  const now = new Date().toISOString();
  const id = newId();
  const { fee = 0, ...holdingInput } = input;
  const holding: Holding = {
    id,
    ...holdingInput,
    symbol: normalizeSymbolForAsset(input.assetType, input.symbol, input.name, id),
    market: input.assetType === "stock" ? (input.market ?? "tse") : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const next = {
    ...state,
    holdings: [...state.holdings, holding],
  };

  if (holding.assetType === "property") return next;

  return {
    ...next,
    transactions: [
      ...state.transactions,
      {
        id: newId(),
        type: "buy",
        holdingId: holding.id,
        assetType: holding.assetType,
        name: holding.name,
        symbol: holding.symbol,
        market: holding.market,
        date: holding.buyDate,
        quantity: holding.quantity,
        price: holding.buyPrice,
        fee: Number.isFinite(fee) && fee > 0 ? fee : 0,
        tax: 0,
        quality: "complete",
        source: "user",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pnlTracking: {
      ...state.pnlTracking,
      startedAt: state.pnlTracking.startedAt || holding.buyDate,
    },
  };
}

function normalizeSymbolForAsset(
  assetType: Holding["assetType"],
  symbol: string,
  name: string,
  id: string
): string {
  if (assetType === "fund") return symbol.replace(/\D/g, "");
  if (assetType === "property") {
    const trimmed = symbol.trim();
    if (trimmed) return trimmed.slice(0, 32);
    const fromName = name.trim().slice(0, 20);
    if (fromName) return fromName;
    return `P-${id.slice(0, 8)}`;
  }
  return normalizeStockSymbol(symbol);
}

/** 更新持倉基本資料（不刪除 priceHistory / 現價） */
export function editHolding(
  state: PortfolioStorage,
  input: EditHoldingInput
): PortfolioStorage {
  const existingHolding = state.holdings.find((h) => h.id === input.id);
  if (!existingHolding) return state;
  const normalizedSymbol = normalizeSymbolForAsset(
    input.assetType,
    input.symbol,
    input.name,
    input.id
  );
  let next = updateHolding(state, input.id, {
    name: input.name.trim(),
    symbol: normalizedSymbol,
    market: input.assetType === "stock" ? (input.market ?? "tse") : undefined,
    buyPrice: input.buyPrice,
    quantity: input.quantity,
    buyDate: input.buyDate,
    lastError: undefined,
    ...(input.assetType === "property"
      ? {
          mortgageBalance:
            input.mortgageBalance !== undefined && input.mortgageBalance > 0
              ? input.mortgageBalance
              : undefined,
        }
      : {}),
  });

  if (input.assetType === "property") return next;
  const originalTransaction = state.transactions.find(
    (transaction) =>
      transaction.holdingId === input.id &&
      (transaction.type === "buy" || transaction.type === "opening_balance")
  );
  if (!originalTransaction) return next;

  const tradeChanged =
    existingHolding.buyPrice !== input.buyPrice ||
    existingHolding.quantity !== input.quantity ||
    existingHolding.buyDate !== input.buyDate ||
    (input.fee !== undefined && input.fee !== originalTransaction.fee);
  const now = new Date().toISOString();
  // 編輯畫面上的數量是目前餘額；若曾部分賣出，只把餘額差額回推至原始交易。
  const correctedOpeningQuantity =
    (originalTransaction.quantity ?? existingHolding.quantity) +
    (input.quantity - existingHolding.quantity);
  const correctedTransaction = {
    ...originalTransaction,
    name: input.name.trim(),
    symbol: normalizedSymbol,
    market: input.assetType === "stock" ? (input.market ?? "tse") : undefined,
    ...(originalTransaction.type === "buy"
      ? {
          date: input.buyDate,
          price: input.buyPrice,
          quantity: correctedOpeningQuantity,
          fee:
            input.fee !== undefined && Number.isFinite(input.fee) && input.fee > 0
              ? input.fee
              : originalTransaction.fee,
        }
      : { quantity: correctedOpeningQuantity }),
    updatedAt: now,
  };
  next = {
    ...next,
    transactions: next.transactions.map((transaction) =>
      transaction.id === originalTransaction.id
        ? correctedTransaction
        : transaction
    ),
  };
  if (!tradeChanged) return next;

  const recalculateFrom =
    originalTransaction.date < correctedTransaction.date
      ? originalTransaction.date
      : correctedTransaction.date;
  return {
    ...next,
    transactionRevisions: [
      ...next.transactionRevisions,
      {
        id: newId(),
        transactionId: originalTransaction.id,
        previous: originalTransaction,
        correctedAt: now,
      },
    ],
    pnlTracking: {
      ...next.pnlTracking,
      dailySummaries: Object.fromEntries(
        Object.entries(next.pnlTracking.dailySummaries).filter(
          ([date]) => date < recalculateFrom
        )
      ),
    },
  };
}

function buildSaleRecord(
  holding: Holding,
  input: SellHoldingInput
): SaleTransaction {
  const costBasis = holding.buyPrice * input.quantity;
  const proceeds = input.sellPrice * input.quantity;
  const fee =
    input.fee !== undefined && Number.isFinite(input.fee) && input.fee > 0
      ? input.fee
      : 0;
  const tax =
    input.tax !== undefined && Number.isFinite(input.tax) && input.tax > 0
      ? input.tax
      : 0;
  return {
    id: newId(),
    holdingId: holding.id,
    assetType: holding.assetType,
    name: holding.name,
    symbol: holding.symbol,
    market: holding.market,
    buyPrice: holding.buyPrice,
    quantity: input.quantity,
    sellPrice: input.sellPrice,
    sellDate: input.sellDate,
    costBasis,
    proceeds,
    realizedPnl: proceeds - costBasis - fee - tax,
    fee,
    tax,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 賣出持倉：寫入賣出紀錄與已實現損益；
 * 部分賣出僅減少 quantity（成本均價不變），全部賣出則移除持倉但保留價格歷史。
 */
export function sellHolding(
  state: PortfolioStorage,
  input: SellHoldingInput
): PortfolioStorage {
  const holding = state.holdings.find((h) => h.id === input.id);
  if (!holding) return state;

  const qty = input.quantity;
  if (!Number.isFinite(qty) || qty <= 0) return state;
  if (!Number.isFinite(input.sellPrice) || input.sellPrice <= 0) return state;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sellDate)) return state;
  if (qty > holding.quantity) return state;

  const sale = buildSaleRecord(holding, input);
  let next: PortfolioStorage = {
    ...state,
    sales: [...state.sales, sale],
  };

  if (holding.assetType !== "property") {
    const now = new Date().toISOString();
    next = {
      ...next,
      transactions: [
        ...next.transactions,
        {
          id: newId(),
          type: "sell",
          holdingId: holding.id,
          assetType: holding.assetType,
          name: holding.name,
          symbol: holding.symbol,
          market: holding.market,
          date: input.sellDate,
          quantity: input.quantity,
          price: input.sellPrice,
          fee: sale.fee ?? 0,
          tax: sale.tax ?? 0,
          quality: "complete",
          source: "user",
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  }

  if (qty >= holding.quantity) {
    return persistPnlSummariesForDates(removeHolding(next, input.id), [
      input.sellDate,
    ]);
  }

  return persistPnlSummariesForDates(
    updateHolding(next, input.id, {
      quantity: holding.quantity - qty,
      lastError: undefined,
    }),
    [input.sellDate]
  );
}

/** 一次套用多筆賣出（例如合併標的 FIFO 分攤），只持久化一次 */
export function sellHoldings(
  state: PortfolioStorage,
  inputs: SellHoldingInput[]
): PortfolioStorage {
  return inputs.reduce((next, input) => sellHolding(next, input), state);
}

/** 手動新增現金股利／基金配息，並以標的、除息日與金額避免重複入帳。 */
export function addCashDividend(
  state: PortfolioStorage,
  input: CashDividendInput
): PortfolioStorage {
  const holding = state.holdings.find((item) => item.id === input.holdingId);
  if (!holding || holding.assetType === "property") return state;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) return state;
  if (!Number.isFinite(input.amount) || input.amount <= 0) return state;
  if (
    input.settlementDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.settlementDate)
  ) {
    return state;
  }
  const duplicate = state.transactions.some(
    (transaction) =>
      transaction.type === "cash_dividend" &&
      transaction.holdingId === input.holdingId &&
      transaction.date === input.effectiveDate &&
      transaction.amount === input.amount
  );
  if (duplicate) return state;

  const now = new Date().toISOString();
  const next: PortfolioStorage = {
    ...state,
    transactions: [
      ...state.transactions,
      {
        id: newId(),
        type: "cash_dividend",
        holdingId: holding.id,
        assetType: holding.assetType,
        name: holding.name,
        symbol: holding.symbol,
        market: holding.market,
        date: input.effectiveDate,
        settlementDate: input.settlementDate,
        amount: input.amount,
        fee: 0,
        tax: 0,
        quality: "complete",
        source: "user",
        note: input.note,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  return persistPnlSummariesForDates(next, [input.effectiveDate]);
}

export function removeHolding(
  state: PortfolioStorage,
  holdingId: string
): PortfolioStorage {
  return {
    ...state,
    holdings: state.holdings.filter((h) => h.id !== holdingId),
  };
}

export function updateHolding(
  state: PortfolioStorage,
  holdingId: string,
  patch: Partial<Holding>
): PortfolioStorage {
  return {
    ...state,
    holdings: state.holdings.map((h) =>
      h.id === holdingId
        ? { ...h, ...patch, updatedAt: new Date().toISOString() }
        : h
    ),
  };
}

/** 追加價格歷史（同日覆寫）並修剪過舊資料 */
/**
 * 批次合併價格歷史（例如集保歷史淨值匯入）
 */
export function mergePriceHistory(
  priceHistory: PriceHistoryMap,
  holdingId: string,
  points: PricePoint[]
): PriceHistoryMap {
  return points.reduce(
    (map, point) => appendPricePoint(map, holdingId, point),
    priceHistory
  );
}

export function appendPricePoint(
  priceHistory: PriceHistoryMap,
  holdingId: string,
  point: PricePoint
): PriceHistoryMap {
  const existing = priceHistory[holdingId] ?? [];
  const withoutSameDay = existing.filter((p) => p.date !== point.date);
  const merged = [...withoutSameDay, point].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_PRICE_HISTORY_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed = merged.filter((p) => p.date >= cutoffStr);

  return { ...priceHistory, [holdingId]: trimmed };
}

function rebaseHistoricalPricesBeforeDate(
  priceHistory: PriceHistoryMap,
  holdingId: string,
  effectiveDate: string,
  adjustmentRatio: number
): PriceHistoryMap {
  if (!Number.isFinite(adjustmentRatio) || adjustmentRatio <= 0) {
    return priceHistory;
  }

  const points = priceHistory[holdingId];
  if (!points || points.length === 0) return priceHistory;

  return {
    ...priceHistory,
    [holdingId]: points.map((point) =>
      point.date < effectiveDate
        ? { ...point, price: point.price / adjustmentRatio }
        : point
    ),
  };
}

function rebaseCurrentPriceBeforeDate(
  holding: Holding,
  effectiveDate: string,
  adjustmentRatio: number
): Partial<Holding> {
  if (
    !holding.currentPrice ||
    !holding.priceDate ||
    holding.priceDate >= effectiveDate ||
    !Number.isFinite(adjustmentRatio) ||
    adjustmentRatio <= 0
  ) {
    return {};
  }

  return {
    currentPrice: holding.currentPrice / adjustmentRatio,
  };
}

function corporateActionAdjustmentRatio(action: CorporateActionRecord): number {
  if (
    action.adjustmentRatio !== undefined &&
    Number.isFinite(action.adjustmentRatio) &&
    action.adjustmentRatio > 0
  ) {
    return action.adjustmentRatio;
  }

  if (
    action.stockDividendRatio !== undefined &&
    Number.isFinite(action.stockDividendRatio) &&
    action.stockDividendRatio > 0
  ) {
    return 1 + action.stockDividendRatio;
  }

  return 1;
}

function shouldRebaseExistingHistory(
  points: PricePoint[] | undefined,
  holding: Holding | undefined,
  action: CorporateActionRecord,
  adjustmentRatio: number
): boolean {
  if (!points || points.length === 0) return false;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const before = [...sorted]
    .reverse()
    .find((point) => point.date < action.effectiveDate);
  if (!before || before.price <= 0) return false;

  const afterFromHistory = sorted.find(
    (point) => point.date >= action.effectiveDate && point.price > 0
  );
  const after =
    afterFromHistory ??
    (holding?.priceDate &&
    holding.priceDate >= action.effectiveDate &&
    holding.currentPrice &&
    holding.currentPrice > 0
      ? {
          date: holding.priceDate,
          price: holding.currentPrice,
          source: holding.priceSource ?? "api",
        }
      : undefined);

  if (!after || after.price <= 0) return false;

  const observedRatio = before.price / after.price;
  if (!Number.isFinite(observedRatio) || observedRatio <= 0) return false;

  const distanceToRaw = Math.abs(Math.log(observedRatio / adjustmentRatio));
  const distanceToAdjusted = Math.abs(Math.log(observedRatio));
  return distanceToRaw + 0.08 < distanceToAdjusted;
}

function markPriceHistoryAdjusted(
  actions: CorporateActionRecord[],
  actionId: string,
  adjustedAt: string
): CorporateActionRecord[] {
  return actions.map((action) =>
    action.id === actionId
      ? {
          ...action,
          priceHistoryAdjustedAt: action.priceHistoryAdjustedAt ?? adjustedAt,
        }
      : action
  );
}

/**
 * 歷史價採除權息還原價時，生效日前的交易也必須換成同一股數單位，
 * 否則拆股後會用「新價格 × 舊股數」而低估每日損益。原始事件另存修訂紀錄。
 */
function rebaseTransactionsBeforeDate(
  state: PortfolioStorage,
  holdingId: string,
  effectiveDate: string,
  adjustmentRatio: number,
  correctedAt: string
): PortfolioStorage {
  if (
    !Number.isFinite(adjustmentRatio) ||
    adjustmentRatio <= 0 ||
    adjustmentRatio === 1
  ) {
    return state;
  }

  const revisions = [...state.transactionRevisions];
  const transactions = state.transactions.map((transaction) => {
    const isPositionEvent =
      transaction.type === "opening_balance" ||
      transaction.type === "buy" ||
      transaction.type === "sell";
    if (
      transaction.holdingId !== holdingId ||
      transaction.date >= effectiveDate ||
      !isPositionEvent ||
      transaction.quantity === undefined
    ) {
      return transaction;
    }

    revisions.push({
      id: newId(),
      transactionId: transaction.id,
      previous: transaction,
      correctedAt,
      reason: `公司行動 ${effectiveDate} 股數單位調整`,
    });
    return {
      ...transaction,
      quantity: transaction.quantity * adjustmentRatio,
      price:
        transaction.price !== undefined
          ? transaction.price / adjustmentRatio
          : undefined,
      updatedAt: correctedAt,
    };
  });

  return { ...state, transactions, transactionRevisions: revisions };
}

function adjustPointForCorporateActions(
  state: PortfolioStorage,
  holdingId: string,
  point: PricePoint
): PricePoint {
  const ratio = state.corporateActions.reduce((product, action) => {
    if (action.holdingId !== holdingId || point.date >= action.effectiveDate) {
      return product;
    }
    const actionRatio = corporateActionAdjustmentRatio(action);
    return actionRatio > 0 ? product * actionRatio : product;
  }, 1);

  if (ratio === 1) return point;
  return { ...point, price: point.price / ratio };
}

export function repairCorporateActionPriceHistory(
  state: PortfolioStorage
): PortfolioStorage {
  let next = state;
  const adjustedAt = new Date().toISOString();

  for (const action of state.corporateActions) {
    if (action.priceHistoryAdjustedAt) continue;

    const adjustmentRatio = corporateActionAdjustmentRatio(action);
    if (!Number.isFinite(adjustmentRatio) || adjustmentRatio <= 0 || adjustmentRatio === 1) {
      next = {
        ...next,
        corporateActions: markPriceHistoryAdjusted(
          next.corporateActions,
          action.id,
          adjustedAt
        ),
      };
      continue;
    }

    const holding = next.holdings.find((h) => h.id === action.holdingId);
    const shouldRebase = shouldRebaseExistingHistory(
      next.priceHistory[action.holdingId],
      holding,
      action,
      adjustmentRatio
    );

    next = {
      ...next,
      priceHistory: shouldRebase
        ? rebaseHistoricalPricesBeforeDate(
            next.priceHistory,
            action.holdingId,
            action.effectiveDate,
            adjustmentRatio
          )
        : next.priceHistory,
      corporateActions: markPriceHistoryAdjusted(
        next.corporateActions,
        action.id,
        adjustedAt
      ),
    };
  }

  return next;
}

export function applyPriceUpdate(
  state: PortfolioStorage,
  holdingId: string,
  price: number,
  priceDate: string,
  source: PriceSource,
  extra?: { name?: string; market?: StockMarket; clearError?: boolean }
): PortfolioStorage {
  const isoDate = normalizeToIsoDate(priceDate) ?? priceDate;
  const point = adjustPointForCorporateActions(state, holdingId, {
    date: isoDate,
    price,
    source,
  });
  let next = {
    ...state,
    priceHistory: appendPricePoint(state.priceHistory, holdingId, point),
  };

  const patch: Partial<Holding> = {
    currentPrice: point.price,
    priceDate: isoDate,
    priceSource: source,
    lastUpdatedAt: new Date().toISOString(),
    ...(extra?.name ? { name: extra.name } : {}),
    ...(extra?.market ? { market: extra.market } : {}),
    ...(extra?.clearError ? { lastError: undefined } : {}),
  };

  next = updateHolding(next, holdingId, patch);
  return persistPnlSummariesForDates(next, [isoDate]);
}

export function updateSettings(
  state: PortfolioStorage,
  settings: Partial<PortfolioSettings>
): PortfolioStorage {
  return {
    ...state,
    settings: { ...state.settings, ...settings },
  };
}

export function applyCorporateAction(
  state: PortfolioStorage,
  event: CorporateActionEvent
): PortfolioStorage {
  const holding = state.holdings.find((h) => h.id === event.holdingId);
  if (!holding || holding.assetType !== "stock") return state;
  if (event.effectiveDate <= holding.buyDate) return state;
  if (hasHandledCorporateAction(state, holding.id, event.id)) return state;

  const ratio =
    Number.isFinite(event.stockDividendRatio) && event.stockDividendRatio > 0
      ? event.stockDividendRatio
      : 0;
  const quantityBefore = holding.quantity;
  const buyPriceBefore = holding.buyPrice;
  const totalCost = quantityBefore * buyPriceBefore;
  const quantityAfter = ratio > 0 ? quantityBefore * (1 + ratio) : quantityBefore;
  const buyPriceAfter =
    ratio > 0 && quantityAfter > 0 ? totalCost / quantityAfter : buyPriceBefore;
  const now = new Date().toISOString();

  const record: CorporateActionRecord = {
    id: newId(),
    holdingId: holding.id,
    assetType: holding.assetType,
    symbol: holding.symbol,
    market: holding.market,
    name: holding.name,
    actionType: event.type,
    effectiveDate: event.effectiveDate,
    source: event.source,
    sourceEventId: event.id,
    stockDividendRatio: event.stockDividendRatio,
    subscriptionRatio: event.subscriptionRatio,
    subscriptionPrice: event.subscriptionPrice,
    cashDividend: event.cashDividend,
    adjustmentRatio: ratio > 0 ? 1 + ratio : undefined,
    quantityBefore,
    quantityAfter,
    buyPriceBefore,
    buyPriceAfter,
    totalCostBefore: totalCost,
    totalCostAfter: ratio > 0 ? totalCost : undefined,
    priceHistoryAdjustedAt: ratio > 0 ? now : undefined,
    note: event.note,
    createdAt: now,
  };

  let withRecord: PortfolioStorage = {
    ...state,
    corporateActions: [...state.corporateActions, record],
  };

  if (
    event.cashDividend !== undefined &&
    Number.isFinite(event.cashDividend) &&
    event.cashDividend > 0
  ) {
    withRecord = {
      ...withRecord,
      transactions: [
        ...withRecord.transactions,
        {
          id: newId(),
          type: "cash_dividend",
          holdingId: holding.id,
          assetType: "stock",
          name: holding.name,
          symbol: holding.symbol,
          market: holding.market,
          date: event.effectiveDate,
          amount: event.cashDividend * quantityBefore,
          fee: 0,
          tax: 0,
          quality: "complete",
          source: "corporate_action",
          note: event.note,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  }

  if (ratio <= 0) {
    return persistPnlSummariesForDates(withRecord, [event.effectiveDate]);
  }

  const adjustmentRatio = 1 + ratio;
  const withAdjustedHistory: PortfolioStorage = {
    ...withRecord,
    priceHistory: rebaseHistoricalPricesBeforeDate(
      withRecord.priceHistory,
      holding.id,
      event.effectiveDate,
      adjustmentRatio
    ),
  };

  const withAdjustedLedger = rebaseTransactionsBeforeDate(
    withAdjustedHistory,
    holding.id,
    event.effectiveDate,
    adjustmentRatio,
    now
  );

  return persistPnlSummariesForDates(
    updateHolding(withAdjustedLedger, holding.id, {
      quantity: quantityAfter,
      buyPrice: buyPriceAfter,
      ...rebaseCurrentPriceBeforeDate(
        holding,
        event.effectiveDate,
        adjustmentRatio
      ),
      lastError: undefined,
    }),
    [event.effectiveDate]
  );
}

export function applyManualCorporateAction(
  state: PortfolioStorage,
  input: ManualCorporateActionInput
): PortfolioStorage {
  const holding = state.holdings.find((h) => h.id === input.holdingId);
  if (!holding || holding.assetType !== "stock") return state;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) return state;
  if (input.effectiveDate <= holding.buyDate) return state;
  if (!Number.isFinite(input.adjustmentRatio) || input.adjustmentRatio <= 0) {
    return state;
  }

  const cashReturnPerShare =
    input.cashReturnPerShare !== undefined &&
    Number.isFinite(input.cashReturnPerShare) &&
    input.cashReturnPerShare > 0
      ? input.cashReturnPerShare
      : 0;
  const quantityBefore = holding.quantity;
  const buyPriceBefore = holding.buyPrice;
  const totalCostBefore = quantityBefore * buyPriceBefore;
  const cashReturnTotal = cashReturnPerShare * quantityBefore;
  const totalCostAfter = Math.max(totalCostBefore - cashReturnTotal, 0);
  const quantityAfter = quantityBefore * input.adjustmentRatio;
  if (!Number.isFinite(quantityAfter) || quantityAfter <= 0) return state;

  const buyPriceAfter = totalCostAfter / quantityAfter;
  const now = new Date().toISOString();
  const sourceEventId = `manual:${holding.id}:${input.effectiveDate}:${input.actionType}:${input.adjustmentRatio}`;
  if (hasHandledCorporateAction(state, holding.id, sourceEventId)) return state;

  const record: CorporateActionRecord = {
    id: newId(),
    holdingId: holding.id,
    assetType: holding.assetType,
    symbol: holding.symbol,
    market: holding.market,
    name: holding.name,
    actionType: input.actionType,
    effectiveDate: input.effectiveDate,
    source: "manual",
    sourceEventId,
    adjustmentRatio: input.adjustmentRatio,
    cashReturnPerShare: cashReturnPerShare || undefined,
    quantityBefore,
    quantityAfter,
    buyPriceBefore,
    buyPriceAfter,
    totalCostBefore,
    totalCostAfter,
    priceHistoryAdjustedAt: now,
    note: input.note?.trim() || undefined,
    createdAt: now,
  };

  let withRecord: PortfolioStorage = {
    ...state,
    corporateActions: [...state.corporateActions, record],
  };

  if (cashReturnTotal > 0) {
    withRecord = {
      ...withRecord,
      transactions: [
        ...withRecord.transactions,
        {
          id: newId(),
          type: "capital_return",
          holdingId: holding.id,
          assetType: "stock",
          name: holding.name,
          symbol: holding.symbol,
          market: holding.market,
          date: input.effectiveDate,
          amount: cashReturnTotal,
          fee: 0,
          tax: 0,
          quality: "complete",
          source: "corporate_action",
          note: input.note?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  }

  const withAdjustedHistory: PortfolioStorage = {
    ...withRecord,
    priceHistory: rebaseHistoricalPricesBeforeDate(
      withRecord.priceHistory,
      holding.id,
      input.effectiveDate,
      input.adjustmentRatio
    ),
  };

  const withAdjustedLedger = rebaseTransactionsBeforeDate(
    withAdjustedHistory,
    holding.id,
    input.effectiveDate,
    input.adjustmentRatio,
    now
  );

  return persistPnlSummariesForDates(
    updateHolding(withAdjustedLedger, holding.id, {
      quantity: quantityAfter,
      buyPrice: buyPriceAfter,
      ...rebaseCurrentPriceBeforeDate(
        holding,
        input.effectiveDate,
        input.adjustmentRatio
      ),
      lastError: undefined,
    }),
    [input.effectiveDate]
  );
}

export function applyManualCorporateActionToGroup(
  state: PortfolioStorage,
  groupKey: string,
  input: Omit<ManualCorporateActionInput, "holdingId">
): PortfolioStorage {
  const lots = state.holdings.filter(
    (holding) => holding.assetType === "stock" && holdingGroupKey(holding) === groupKey
  );

  return lots.reduce(
    (next, holding) =>
      applyManualCorporateAction(next, {
        ...input,
        holdingId: holding.id,
      }),
    state
  );
}

/** 將匯入的歷史價格寫入 priceHistory，並以最新一筆更新持倉現價 */
export function applyImportedPriceHistory(
  state: PortfolioStorage,
  holdingId: string,
  points: PricePoint[]
): PortfolioStorage {
  if (points.length === 0) return state;

  const sorted = points
    .map((point) => adjustPointForCorporateActions(state, holdingId, point))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  let next: PortfolioStorage = {
    ...state,
    priceHistory: mergePriceHistory(state.priceHistory, holdingId, sorted),
  };

  next = updateHolding(next, holdingId, {
    currentPrice: latest.price,
    priceDate: latest.date,
    priceSource: "api",
    lastUpdatedAt: new Date().toISOString(),
    lastError: undefined,
  });

  return persistPnlSummariesForDates(
    next,
    sorted.map((point) => point.date)
  );
}

/** 舊名稱相容 */
export const applyFundNavHistory = applyImportedPriceHistory;
