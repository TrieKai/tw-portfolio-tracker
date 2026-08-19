import { normalizeToIsoDate } from "@/lib/date/iso-date";
import type {
  Holding,
  PortfolioSettings,
  PortfolioStorage,
  PriceHistoryMap,
  PricePoint,
} from "@/lib/types/holding";
import { normalizeUiPreferences } from "@/lib/ui/preferences";
import { migratePortfolioStorage } from "@/lib/storage/portfolio-migration";

const DEFAULT_SETTINGS: PortfolioSettings = {
  autoUpdateEnabled: false,
  theme: "system",
};

export function defaultPortfolioStorage(): PortfolioStorage {
  return {
    version: 2,
    holdings: [],
    priceHistory: {},
    sales: [],
    corporateActions: [],
    transactions: [],
    transactionRevisions: [],
    pnlTracking: { startedAt: "", dailySummaries: {} },
    settings: { ...DEFAULT_SETTINGS },
  };
}

function normalizeHoldingDates(holding: Holding): Holding {
  const buyDate = normalizeToIsoDate(holding.buyDate) ?? holding.buyDate;
  const priceDate = holding.priceDate
    ? normalizeToIsoDate(holding.priceDate) ?? holding.priceDate
    : holding.priceDate;
  if (buyDate === holding.buyDate && priceDate === holding.priceDate) {
    return holding;
  }
  return { ...holding, buyDate, priceDate };
}

/** 修正歷史價格中的 YYYYMMDD／斜線日期，避免時間軸與比較失效 */
function normalizePriceHistoryMap(priceHistory: PriceHistoryMap): PriceHistoryMap {
  const next: PriceHistoryMap = {};
  for (const [holdingId, points] of Object.entries(priceHistory ?? {})) {
    if (!Array.isArray(points)) continue;
    const normalizedPoints: PricePoint[] = [];
    const byDate = new Map<string, PricePoint>();
    for (const point of points) {
      if (!point || typeof point.date !== "string") continue;
      const date = normalizeToIsoDate(point.date);
      if (!date) continue;
      byDate.set(date, { ...point, date });
    }
    normalizedPoints.push(...byDate.values());
    normalizedPoints.sort((a, b) => a.date.localeCompare(b.date));
    next[holdingId] = normalizedPoints;
  }
  return next;
}

/** 驗證並正規化未知 JSON 為 PortfolioStorage */
export function normalizePortfolioStorage(raw: unknown): PortfolioStorage | null {
  if (!raw || typeof raw !== "object") return null;
  const version = (raw as { version?: unknown }).version;
  let migrated: unknown = raw;
  if (version === 1) {
    try {
      migrated = migratePortfolioStorage(raw, {
        migratedAt: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  }
  const parsed = migrated as PortfolioStorage;
  if (parsed.version !== 2 || !Array.isArray(parsed.holdings)) return null;

  const rawSettings =
    parsed.settings && typeof parsed.settings === "object"
      ? parsed.settings
      : DEFAULT_SETTINGS;

  return {
    ...defaultPortfolioStorage(),
    ...parsed,
    holdings: parsed.holdings.map(normalizeHoldingDates),
    priceHistory: normalizePriceHistoryMap(
      parsed.priceHistory && typeof parsed.priceHistory === "object"
        ? parsed.priceHistory
        : {}
    ),
    sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    corporateActions: Array.isArray(parsed.corporateActions)
      ? parsed.corporateActions
      : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    transactionRevisions: Array.isArray(parsed.transactionRevisions)
      ? parsed.transactionRevisions
      : [],
    pnlTracking:
      parsed.pnlTracking && typeof parsed.pnlTracking === "object"
        ? {
            startedAt:
              typeof parsed.pnlTracking.startedAt === "string"
                ? parsed.pnlTracking.startedAt
                : "",
            dailySummaries:
              parsed.pnlTracking.dailySummaries &&
              typeof parsed.pnlTracking.dailySummaries === "object"
                ? parsed.pnlTracking.dailySummaries
                : {},
          }
        : { startedAt: "", dailySummaries: {} },
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
