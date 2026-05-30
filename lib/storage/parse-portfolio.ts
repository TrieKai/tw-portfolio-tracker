import type { PortfolioSettings, PortfolioStorage } from "@/lib/types/holding";

const DEFAULT_SETTINGS: PortfolioSettings = {
  autoUpdateEnabled: false,
  theme: "system",
};

export function defaultPortfolioStorage(): PortfolioStorage {
  return {
    version: 1,
    holdings: [],
    priceHistory: {},
    sales: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** 驗證並正規化未知 JSON 為 PortfolioStorage */
export function normalizePortfolioStorage(raw: unknown): PortfolioStorage | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as PortfolioStorage;
  if (parsed.version !== 1 || !Array.isArray(parsed.holdings)) return null;

  return {
    ...defaultPortfolioStorage(),
    ...parsed,
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
  };
}

export function hasPortfolioData(state: PortfolioStorage): boolean {
  return state.holdings.length > 0 || state.sales.length > 0;
}
