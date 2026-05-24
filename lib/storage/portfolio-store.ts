/**
 * 本地投資組合儲存（LocalStorage）
 * 資料僅存在使用者瀏覽器，不上傳伺服器。
 */

import { PORTFOLIO_STORAGE_KEY, MAX_PRICE_HISTORY_DAYS } from "@/lib/portfolio/constants";
import { normalizeStockSymbol } from "@/lib/prices/stock-symbol";
import type {
  CreateHoldingInput,
  EditHoldingInput,
  Holding,
  PortfolioSettings,
  PortfolioStorage,
  PriceHistoryMap,
  PricePoint,
  PriceSource,
} from "@/lib/types/holding";

const DEFAULT_SETTINGS: PortfolioSettings = {
  autoUpdateEnabled: false,
  theme: "system",
};

function defaultStorage(): PortfolioStorage {
  return {
    version: 1,
    holdings: [],
    priceHistory: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function loadPortfolio(): PortfolioStorage {
  if (typeof window === "undefined") return defaultStorage();

  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return defaultStorage();
    const parsed = JSON.parse(raw) as PortfolioStorage;
    if (parsed.version !== 1 || !Array.isArray(parsed.holdings)) {
      return defaultStorage();
    }
    return {
      ...defaultStorage(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    };
  } catch {
    return defaultStorage();
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

export function addHolding(
  state: PortfolioStorage,
  input: CreateHoldingInput
): PortfolioStorage {
  const now = new Date().toISOString();
  const holding: Holding = {
    id: newId(),
    ...input,
    symbol:
      input.assetType === "fund"
        ? input.symbol.replace(/\D/g, "")
        : normalizeStockSymbol(input.symbol),
    market: input.assetType === "stock" ? (input.market ?? "tse") : undefined,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    holdings: [...state.holdings, holding],
  };
}

function normalizeSymbolForAsset(
  assetType: Holding["assetType"],
  symbol: string
): string {
  return assetType === "fund"
    ? symbol.replace(/\D/g, "")
    : normalizeStockSymbol(symbol);
}

/** 更新持倉基本資料（不刪除 priceHistory / 現價） */
export function editHolding(
  state: PortfolioStorage,
  input: EditHoldingInput
): PortfolioStorage {
  const exists = state.holdings.some((h) => h.id === input.id);
  if (!exists) return state;

  return updateHolding(state, input.id, {
    name: input.name.trim(),
    symbol: normalizeSymbolForAsset(input.assetType, input.symbol),
    market: input.assetType === "stock" ? (input.market ?? "tse") : undefined,
    buyPrice: input.buyPrice,
    quantity: input.quantity,
    buyDate: input.buyDate,
    lastError: undefined,
  });
}

export function removeHolding(
  state: PortfolioStorage,
  holdingId: string
): PortfolioStorage {
  const { [holdingId]: _, ...restHistory } = state.priceHistory;
  return {
    ...state,
    holdings: state.holdings.filter((h) => h.id !== holdingId),
    priceHistory: restHistory,
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

export function applyPriceUpdate(
  state: PortfolioStorage,
  holdingId: string,
  price: number,
  priceDate: string,
  source: PriceSource,
  extra?: { name?: string; clearError?: boolean }
): PortfolioStorage {
  const point: PricePoint = { date: priceDate, price, source };
  let next = {
    ...state,
    priceHistory: appendPricePoint(state.priceHistory, holdingId, point),
  };

  const patch: Partial<Holding> = {
    currentPrice: price,
    priceDate,
    priceSource: source,
    lastUpdatedAt: new Date().toISOString(),
    ...(extra?.name ? { name: extra.name } : {}),
    ...(extra?.clearError ? { lastError: undefined } : {}),
  };

  next = updateHolding(next, holdingId, patch);
  return next;
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

/** 將匯入的歷史價格寫入 priceHistory，並以最新一筆更新持倉現價 */
export function applyImportedPriceHistory(
  state: PortfolioStorage,
  holdingId: string,
  points: PricePoint[]
): PortfolioStorage {
  if (points.length === 0) return state;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
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

  return next;
}

/** 舊名稱相容 */
export const applyFundNavHistory = applyImportedPriceHistory;
