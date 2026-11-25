import { corporateActionAdjustmentRatio, holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { linkSaleEvents } from "@/lib/portfolio/sale-events";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import type { PortfolioStorage, PortfolioTransaction, SaleTransaction } from "@/lib/types/holding";
import { mergePriceHistory, repairCorporateActionPriceHistory } from "@/lib/storage/portfolio-store";
import { normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";

/** 匯出檔外層格式（含版本與時間戳，方便日後遷移） */
export interface PortfolioExportFile {
  app: "tw-portfolio-tracker";
  exportVersion: 1;
  exportedAt: string;
  portfolio: PortfolioStorage;
}

export type PortfolioImportMode = "replace" | "merge";

export function buildExportFile(
  portfolio: PortfolioStorage
): PortfolioExportFile {
  return {
    app: "tw-portfolio-tracker",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    portfolio,
  };
}

export function describePortfolioStorage(state: PortfolioStorage): string {
  const historyKeys = Object.keys(state.priceHistory).length;
  return `${state.holdings.length} 筆持倉、${state.loans.length} 筆貸款、${state.sales.length} 筆賣出紀錄、${historyKeys} 組價格歷史`;
}

/** 從匯出檔或裸 PortfolioStorage JSON 解析 */
export function parseImportPayload(
  raw: unknown
): { ok: true; portfolio: PortfolioStorage } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "檔案格式無效" };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.app === "tw-portfolio-tracker" && obj.exportVersion === 1) {
    const portfolio = normalizePortfolioStorage(obj.portfolio);
    if (!portfolio) {
      return { ok: false, error: "匯出檔內的投資組合資料無效" };
    }
    return { ok: true, portfolio };
  }

  const direct = normalizePortfolioStorage(raw);
  if (direct) {
    return { ok: true, portfolio: direct };
  }

  return {
    ok: false,
    error: "無法辨識的備份格式（需為本 App 匯出的 JSON 或 version:1／2 的持倉資料）",
  };
}

function mergeRecords<T extends { id: string }>(
  current: T[],
  incoming: T[],
  timestamp?: (record: T) => string
): T[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const existing = records.get(record.id);
    if (!existing || (timestamp && timestamp(record) > timestamp(existing))) {
      records.set(record.id, record);
    }
  }
  return [...records.values()];
}

function instrumentKeys(state: PortfolioStorage) {
  const keys = new Map<string, string>();
  for (const item of [...state.sales, ...state.transactions, ...state.holdings]) {
    const id = "holdingId" in item ? item.holdingId : item.id;
    keys.set(id, holdingGroupKey({ ...item, id }));
  }
  return keys;
}

function adjustedTransactions(
  state: PortfolioStorage,
  mergedActions: PortfolioStorage["corporateActions"]
): PortfolioTransaction[] {
  return state.transactions.map((event) => {
    if (!event.quantity || !["buy", "opening_balance", "sell"].includes(event.type)) return event;
    const groupKey = holdingGroupKey({ ...event, id: event.holdingId });
    const matchesEvent = (action: PortfolioStorage["corporateActions"][number]) =>
      action.holdingId === event.holdingId &&
      holdingGroupKey({ ...action, id: action.holdingId }) === groupKey;
    const ratio = shareAdjustmentAfter(mergedActions.filter(matchesEvent), event.date) /
      shareAdjustmentAfter(state.corporateActions.filter(matchesEvent), event.date);
    return ratio === 1 ? event : {
      ...event,
      quantity: event.quantity * ratio,
      price: event.price === undefined ? undefined : event.price / ratio,
    };
  });
}

export type SaleImportChoice = "local" | "backup" | "both";
export type SaleImportChoices = Record<string, SaleImportChoice>;

export interface SaleImportConflict {
  key: string;
  local: SaleTransaction[];
  backup: SaleTransaction[];
  canKeepBoth: boolean;
}

export type PortfolioImportResult =
  | { status: "saved" | "failed" }
  | { status: "review"; conflicts: SaleImportConflict[] };

export class SaleImportReviewRequired extends Error {
  constructor(readonly conflicts: SaleImportConflict[]) {
    super("請先核對疑似重複的賣出成交");
  }
}

function duplicateSaleGroups(current: SaleTransaction[], incoming: SaleTransaction[]) {
  const currentIds = new Set(current.map((sale) => sale.id));
  const incomingIds = new Set(incoming.map((sale) => sale.id));
  const group = (sales: SaleTransaction[], otherIds: Set<string>) => {
    const records = new Map<string, SaleTransaction[]>();
    for (const sale of sales) {
      if (otherIds.has(sale.id)) continue;
      const key = JSON.stringify([sale.holdingId, sale.sellDate, sale.quantity, sale.sellPrice]);
      const matches = records.get(key) ?? [];
      matches.push(sale);
      records.set(key, matches);
    }
    return records;
  };
  const local = group(current, incomingIds);
  const backup = group(incoming, currentIds);
  return Array.from(local, ([key, records]) => ({ local: records, backup: backup.get(key) ?? [] }))
    .filter((pair) => pair.backup.length > 0);
}

function withoutSales(state: PortfolioStorage, rejected: Set<string>) {
  if (!rejected.size) return { sales: state.sales, transactions: state.transactions };
  const { linked } = linkSaleEvents(state.sales, state.transactions);
  return {
    sales: state.sales.filter((sale) => !rejected.has(sale.id)),
    transactions: state.transactions.filter((event) =>
      !rejected.has(event.saleId ?? linked.get(event.id)?.id ?? "")
    ),
  };
}

/** 以修改時間合併可編輯紀錄；同時刻或無修改時間的衝突保留本機。 */
export function mergePortfolioStorage(
  local: PortfolioStorage,
  backup: PortfolioStorage,
  choices: SaleImportChoices = {}
): PortfolioStorage {
  const current = repairCorporateActionPriceHistory(local);
  const incoming = repairCorporateActionPriceHistory(backup);
  const currentKeys = instrumentKeys(current);
  const incomingKeys = instrumentKeys(incoming);
  const actionsByEvent = new Map(
    current.corporateActions.map((action) => [`${action.holdingId}:${action.sourceEventId}`, action])
  );
  for (const action of incoming.corporateActions) {
    const key = `${action.holdingId}:${action.sourceEventId}`;
    if (!actionsByEvent.has(key)) actionsByEvent.set(key, action);
  }
  const corporateActions = [...actionsByEvent.values()];
  const currentById = new Map(current.holdings.map((holding) => [holding.id, holding]));
  const incomingIds = new Set(incoming.holdings.map((holding) => holding.id));
  const currentSalesIds = new Set(current.sales.map((sale) => sale.id));
  const incomingSalesIds = new Set(incoming.sales.map((sale) => sale.id));
  const selectedHoldings = mergeRecords(current.holdings, incoming.holdings, (holding) => holding.updatedAt);
  const selectedKeys = new Map(selectedHoldings.map((holding) => [holding.id, holdingGroupKey(holding)]));
  const selectedById = new Map(selectedHoldings.map((holding) => [holding.id, holding]));
  const mergedSales = mergeRecords(current.sales, incoming.sales, (sale) => sale.updatedAt ?? sale.createdAt);

  const duplicates: SaleImportConflict[] = duplicateSaleGroups(current.sales, incoming.sales).map((group) => {
    const id = group.local[0].holdingId;
    const holding = selectedById.get(id);
    const fromCurrent = holding && currentById.get(id) === holding;
    const source = fromCurrent ? current : incoming;
    const sourceIds = fromCurrent ? currentSalesIds : incomingSalesIds;
    const actions = holding ? holdingActions(corporateActions, holding) : [];
    const sourceActions = holding ? holdingActions(source.corporateActions, holding) : [];
    const trades = mergedSales.filter((sale) => sale.holdingId === id);
    const addedQuantity = trades.reduce((sum, sale) =>
      sourceIds.has(sale.id) ? sum : sum + sale.quantity * shareAdjustmentAfter(actions, sale.sellDate), 0
    );
    // 使用各筆成交日期的股數換算，並預留同一批次其他備份成交。
    const canKeepBoth = Boolean(holding && currentById.has(id) && incomingIds.has(id) &&
      !trades.some((sale) => sale.positionClosed) &&
      addedQuantity <= holding.quantity * shareAdjustmentAfter(actions, holding.buyDate) /
        shareAdjustmentAfter(sourceActions, holding.buyDate));
    return {
      ...group,
      canKeepBoth,
      key: JSON.stringify([group.local, group.backup].map((sales) =>
        sales.map((sale) => [sale.id, sale.updatedAt ?? sale.createdAt]).sort()
      )),
    };
  });
  if (duplicates.some((conflict) =>
    choices[conflict.key] !== "local" && choices[conflict.key] !== "backup" &&
    !(choices[conflict.key] === "both" && conflict.canKeepBoth)
  )) throw new SaleImportReviewRequired(duplicates);

  const droppedLocal = new Set<string>();
  const droppedBackup = new Set<string>();
  for (const conflict of duplicates) {
    const choice = choices[conflict.key];
    if (choice === "local") for (const sale of conflict.backup) droppedBackup.add(sale.id);
    if (choice === "backup") for (const sale of conflict.local) droppedLocal.add(sale.id);
  }
  const currentTrades = withoutSales(current, droppedLocal);
  const incomingTrades = withoutSales(incoming, droppedBackup);
  const sales = mergedSales.filter((sale) => !droppedLocal.has(sale.id) && !droppedBackup.has(sale.id));
  const currentClosed = new Set([
    ...currentTrades.sales.map((sale) => sale.holdingId),
    ...currentTrades.transactions.filter((event) => event.type === "sell").map((event) => event.holdingId),
  ].filter((id) => !currentById.has(id)));

  const salesByHolding = new Map<string, SaleTransaction[]>();
  for (const sale of sales) {
    const records = salesByHolding.get(sale.holdingId) ?? [];
    records.push(sale);
    salesByHolding.set(sale.holdingId, records);
  }

  const holdings = selectedHoldings.flatMap((holding) => {
    const holdingSales = salesByHolding.get(holding.id) ?? [];
    const closedInBackup = !incomingIds.has(holding.id) && holdingSales.some((sale) =>
      incomingSalesIds.has(sale.id) && sale.positionClosed === undefined && sale.createdAt >= holding.updatedAt
    );
    if (currentClosed.has(holding.id) || closedInBackup ||
        holdingSales.some((sale) => sale.positionClosed === true)) return [];

    const fromCurrent = currentById.get(holding.id) === holding;
    const sourceSaleIds = fromCurrent ? currentSalesIds : incomingSalesIds;
    const source = fromCurrent ? current : incoming;
    const matchesHolding = (action: PortfolioStorage["corporateActions"][number]) =>
      action.holdingId === holding.id &&
      holdingGroupKey({ ...action, id: holding.id }) === selectedKeys.get(holding.id);
    const mergedBasis = corporateActions.filter(matchesHolding);
    const sourceBasis = source.corporateActions.filter(matchesHolding);
    const quantityRatio = shareAdjustmentAfter(mergedBasis, holding.buyDate) /
      shareAdjustmentAfter(sourceBasis, holding.buyDate);
    const soldQuantity = holdingSales.reduce((quantity, sale) =>
      sourceSaleIds.has(sale.id) ? quantity : quantity + sale.quantity * shareAdjustmentAfter(mergedBasis, sale.sellDate),
      0
    );
    // 持倉餘量包含來源端已扣除的成交。排除重複紀錄時，只回補被放棄的本側成交。
    const rejected = fromCurrent ? droppedLocal : droppedBackup;
    const restoredQuantity = source.sales.reduce((quantity, sale) =>
      sale.holdingId === holding.id && rejected.has(sale.id)
        ? quantity + sale.quantity * shareAdjustmentAfter(mergedBasis, sale.sellDate)
        : quantity, 0
    );
    const quantity = holding.quantity * quantityRatio + restoredQuantity - soldQuantity;
    if (quantity <= Number.EPSILON * Math.max(holding.quantity, soldQuantity)) return [];
    const sourceActions = new Set(sourceBasis.map((action) => action.sourceEventId));
    const costReduction = mergedBasis.reduce((total, action) => {
      if (sourceActions.has(action.sourceEventId) || action.effectiveDate <= holding.buyDate) return total;
      const returned = (action.cashReturnPerShare ?? 0) / corporateActionAdjustmentRatio(action);
      return total + returned / shareAdjustmentAfter(mergedBasis, action.effectiveDate);
    }, 0);
    const priceRatio = holding.priceDate
      ? shareAdjustmentAfter(sourceBasis, holding.priceDate) / shareAdjustmentAfter(mergedBasis, holding.priceDate)
      : 1;
    return [{
      ...holding,
      quantity,
      buyPrice: Math.max(0, holding.buyPrice / quantityRatio - costReduction),
      currentPrice: holding.currentPrice === undefined ? undefined : holding.currentPrice * priceRatio,
    }];
  });

  let priceHistory: PortfolioStorage["priceHistory"] = {};
  for (const holdingId of new Set([...Object.keys(current.priceHistory), ...Object.keys(incoming.priceHistory)])) {
    const instrument = selectedKeys.get(holdingId) ?? currentKeys.get(holdingId) ?? incomingKeys.get(holdingId);
    const matchingActions = (actions: PortfolioStorage["corporateActions"]) =>
      actions.filter((action) =>
        action.holdingId === holdingId &&
        (!instrument || holdingGroupKey({ ...action, id: holdingId }) === instrument)
      );
    const mergedBasis = matchingActions(corporateActions);
    const rebase = (state: PortfolioStorage, sourceKey: string | undefined) => {
      if (sourceKey && instrument && sourceKey !== instrument) return [];
      const sourceBasis = matchingActions(state.corporateActions);
      return (state.priceHistory[holdingId] ?? []).map((point) => {
        const ratio = shareAdjustmentAfter(sourceBasis, point.date) / shareAdjustmentAfter(mergedBasis, point.date);
        return ratio === 1 ? point : { ...point, price: point.price * ratio };
      });
    };
    const existing = rebase(current, currentKeys.get(holdingId));
    if (existing.length) priceHistory[holdingId] = existing;
    const existingDates = new Set(existing.map((point) => point.date));
    const added = rebase(incoming, incomingKeys.get(holdingId)).filter((point) => !existingDates.has(point.date));
    if (added.length) priceHistory = mergePriceHistory(priceHistory, holdingId, added);
  }

  const dailySummaries = { ...current.pnlTracking.dailySummaries };
  for (const [date, summary] of Object.entries(incoming.pnlTracking.dailySummaries)) {
    if (!dailySummaries[date] || summary.computedAt > dailySummaries[date].computedAt) {
      dailySummaries[date] = summary;
    }
  }
  if (duplicates.length) {
    const rejectedDates = mergedSales.filter((sale) => droppedLocal.has(sale.id) || droppedBackup.has(sale.id));
    for (const sale of rejectedDates) delete dailySummaries[sale.sellDate];
  }
  const currentHasData = current.holdings.length > 0 || current.loans.length > 0 ||
    current.transactions.length > 0 || current.sales.length > 0;
  return {
    version: 2,
    holdings,
    loans: mergeRecords(current.loans, incoming.loans, (loan) => loan.updatedAt),
    loanRevisions: mergeRecords(current.loanRevisions, incoming.loanRevisions),
    sales,
    corporateActions,
    transactions: mergeRecords(
      adjustedTransactions({ ...current, transactions: currentTrades.transactions }, corporateActions),
      adjustedTransactions({ ...incoming, transactions: incomingTrades.transactions }, corporateActions),
      (event) => event.updatedAt
    ),
    transactionRevisions: mergeRecords(current.transactionRevisions, incoming.transactionRevisions),
    pnlTracking: {
      startedAt: current.pnlTracking.startedAt || incoming.pnlTracking.startedAt,
      dailySummaries,
    },
    priceHistory,
    settings: {
      ...(currentHasData ? current.settings : incoming.settings),
      theme: current.settings.theme ?? incoming.settings.theme,
      uiPreferences: current.settings.uiPreferences ?? incoming.settings.uiPreferences,
    },
  };
}

export function applyImportMode(
  current: PortfolioStorage,
  incoming: PortfolioStorage,
  mode: PortfolioImportMode,
  choices?: SaleImportChoices
): PortfolioStorage {
  if (mode === "replace") {
    return {
      ...incoming,
      settings: {
        ...incoming.settings,
        theme: current.settings.theme ?? incoming.settings.theme,
        uiPreferences: current.settings.uiPreferences ?? incoming.settings.uiPreferences,
      },
    };
  }
  return mergePortfolioStorage(current, incoming, choices);
}

export function buildExportFilename(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `portfolio-backup-${d}.json`;
}

/** 觸發瀏覽器下載 JSON（僅客戶端） */
export function downloadPortfolioExport(portfolio: PortfolioStorage): void {
  if (typeof window === "undefined") return;

  const file = buildExportFile(portfolio);
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildExportFilename();
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readPortfolioImportFile(
  file: File
): Promise<
  { ok: true; portfolio: PortfolioStorage } | { ok: false; error: string }
> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    return { ok: false, error: "請選擇 .json 備份檔" };
  }

  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: "檔案過大（上限 8MB）" };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "無法讀取檔案" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "JSON 格式錯誤" };
  }

  return parseImportPayload(raw);
}
