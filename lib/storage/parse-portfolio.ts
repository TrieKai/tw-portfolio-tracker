import type { PortfolioSettings, PortfolioStorage } from "@/lib/types/holding";
import { normalizeUiPreferences } from "@/lib/ui/preferences";

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
    corporateActions: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** 驗證並正規化未知 JSON 為 PortfolioStorage */
export function normalizePortfolioStorage(raw: unknown): PortfolioStorage | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as PortfolioStorage;
  if (parsed.version !== 1 || !Array.isArray(parsed.holdings)) return null;

  const rawSettings =
    parsed.settings && typeof parsed.settings === "object"
      ? parsed.settings
      : DEFAULT_SETTINGS;

  return {
    ...defaultPortfolioStorage(),
    ...parsed,
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    corporateActions: Array.isArray(parsed.corporateActions)
      ? parsed.corporateActions
      : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      ...(rawSettings.uiPreferences
        ? { uiPreferences: normalizeUiPreferences(rawSettings.uiPreferences) }
        : {}),
    },
  };
}

export function hasPortfolioData(state: PortfolioStorage): boolean {
  return (
    state.holdings.length > 0 ||
    state.sales.length > 0 ||
    state.corporateActions.length > 0
  );
}
