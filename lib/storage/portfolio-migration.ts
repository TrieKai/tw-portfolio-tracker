interface MigrationOptions {
  migratedAt: string;
}

interface LegacyHolding {
  id: string;
  assetType: "stock" | "fund" | "property";
  name: string;
  symbol: string;
  market?: "tse" | "otc";
  buyPrice: number;
  quantity: number;
  currentPrice?: number;
}

interface LegacyPortfolio {
  version: number;
  holdings: LegacyHolding[];
  priceHistory: Record<string, unknown>;
  sales: unknown[];
  corporateActions: unknown[];
  settings: Record<string, unknown>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLegacyHolding(value: unknown): value is LegacyHolding {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.assetType === "stock" ||
      value.assetType === "fund" ||
      value.assetType === "property") &&
    typeof value.name === "string" &&
    typeof value.symbol === "string" &&
    typeof value.buyPrice === "number" &&
    typeof value.quantity === "number"
  );
}

function isLegacyPortfolio(value: unknown): value is LegacyPortfolio {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    Array.isArray(value.holdings) &&
    value.holdings.every(isLegacyHolding) &&
    isRecord(value.priceHistory) &&
    Array.isArray(value.sales) &&
    Array.isArray(value.corporateActions) &&
    isRecord(value.settings)
  );
}

/**
 * 將舊儲存格式升級成可追蹤每日損益的格式。升級只新增欄位，不會刪除
 * 既有持倉、價格、賣出或公司行動資料。
 */
export function migratePortfolioStorage(
  raw: unknown,
  options: MigrationOptions
): LegacyPortfolio {
  if (!isLegacyPortfolio(raw)) {
    throw new Error("無法辨識投資組合資料格式");
  }
  if (raw.version >= 2) return raw;

  const startedAt = options.migratedAt.slice(0, 10);
  const createdAt = options.migratedAt;
  const transactions = raw.holdings
    .filter((holding) => holding.assetType !== "property")
    .map((holding) => ({
      id: `opening-${holding.id}`,
      type: "opening_balance" as const,
      holdingId: holding.id,
      assetType: holding.assetType,
      name: holding.name,
      symbol: holding.symbol,
      market: holding.market,
      date: startedAt,
      quantity: holding.quantity,
      price: holding.currentPrice ?? holding.buyPrice,
      fee: 0,
      tax: 0,
      quality: "complete" as const,
      source: "migration" as const,
      createdAt,
      updatedAt: createdAt,
    }));

  return {
    ...raw,
    version: 2,
    transactions,
    transactionRevisions: [],
    pnlTracking: {
      startedAt,
      dailySummaries: {},
    },
  };
}
