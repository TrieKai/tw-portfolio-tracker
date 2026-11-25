import { corporateActionAdjustmentRatio, costOnDate, holdingActions, shareAdjustmentAfter } from "@/lib/corporate-actions/adjustment";
import { reconcileCorporateDividends } from "@/lib/portfolio/corporate-dividends";
import { linkSaleEvents } from "@/lib/portfolio/sale-events";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import { priceHistoryStartDate } from "@/lib/portfolio/chart-date-range";
import { pnlDatesUsingChangedPrices, restoreLatestQuote } from "@/lib/portfolio/price-history";
import type { CorporateActionRecord, Holding, HoldingRemoval, PortfolioStorage, PortfolioTransaction, PricePoint, SaleTransaction } from "@/lib/types/holding";
import { mergePriceHistory, persistPnlSummariesForDates, repairCorporateActionPriceHistory } from "@/lib/storage/portfolio-store";
import { mergeDailyPnlSummaries } from "@/lib/storage/merge-daily-pnl";
import type { Loan, LoanPaymentRecord } from "@/lib/types/loan";
import type { RecordImportReview } from "@/lib/types/portfolio-import";
import { decodePortfolioStorage, hasPortfolioData, type PortfolioDecodeResult } from "@/lib/storage/parse-portfolio";
import { isRecord } from "@/lib/storage/portfolio-shape";

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
  const removals = state.holdingRemovals?.length ? `、${state.holdingRemovals.length} 筆已移除持倉` : "";
  return `${state.holdings.length} 筆持倉、${state.loans.length} 筆貸款、${state.sales.length} 筆賣出、${state.transactions.length} 筆交易、${historyKeys} 組價格歷史${removals}`;
}

/** 從匯出檔或裸 PortfolioStorage JSON 解析 */
export function parseImportPayload(raw: unknown): PortfolioDecodeResult {
  if (isRecord(raw) && raw.app === "tw-portfolio-tracker") {
    if (raw.exportVersion !== 1) return { ok: false, error: "無法辨識備份檔版本。" };
    return decodePortfolioStorage(raw.portfolio);
  }
  return decodePortfolioStorage(raw);
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

function mergeManualDividends(transactions: PortfolioTransaction[]): PortfolioTransaction[] {
  const dividendIndices = new Map<string, number>();
  const merged: PortfolioTransaction[] = [];
  for (const event of transactions) {
    if (event.type !== "cash_dividend" || event.source !== "user") {
      merged.push(event);
      continue;
    }
    const instrument = holdingGroupKey({ ...event, id: event.holdingId });
    const key = JSON.stringify([event.holdingId, instrument, event.date, event.amount]);
    const index = dividendIndices.get(key);
    if (index === undefined) {
      dividendIndices.set(key, merged.length);
      merged.push(event);
      continue;
    }
    // 兩台裝置各自登錄同一筆配息時，補齊任一邊尚未填寫的入帳資訊。
    const previous = merged[index];
    const useIncoming = event.updatedAt > previous.updatedAt ||
      (event.updatedAt === previous.updatedAt && event.id < previous.id);
    const [latest, older] = useIncoming ? [event, previous] : [previous, event];
    merged[index] = {
      ...latest,
      settlementDate: latest.settlementDate ?? older.settlementDate,
      note: latest.note || older.note,
    };
  }
  return merged;
}

function instrumentKeys(state: PortfolioStorage) {
  const keys = new Map<string, string>();
  for (const item of [...state.sales, ...state.transactions, ...state.holdings, ...(state.holdingRemovals ?? []).map(({ holding }) => holding)]) {
    const id = "holdingId" in item ? item.holdingId : item.id;
    keys.set(id, holdingGroupKey({ ...item, id }));
  }
  return keys;
}

function pnlDatesUsingDifferentPrices(points: PricePoint[], source: PricePoint[], dates: string[], earliest: string) {
  const sourceByDate = new Map(source.map(({ date, price }) => [date, price]));
  const changed = new Set<string>();
  for (const { date, price } of points) {
    const previous = sourceByDate.get(date);
    // 早於保留期且缺少行情無法證明摘要有誤。若仍有存檔，直接比對復權後的價格。
    if (previous === undefined ? date >= earliest :
      Math.abs(price - previous) > 8 * Number.EPSILON * Math.max(price, previous)) changed.add(date);
  }
  return pnlDatesUsingChangedPrices(points, changed, dates);
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
export type PortfolioImportChoices = Record<string, SaleImportChoice | string[]>;

export interface SaleImportConflict {
  kind: "duplicate" | "oversold";
  key: string;
  local: SaleTransaction[];
  backup: SaleTransaction[];
  canKeepBoth: boolean;
  canKeepLocal?: boolean;
  canKeepBackup?: boolean;
  capacity?: number;
  mergedQuantity?: number;
}

export interface LoanPaymentImportConflict {
  kind: "loan_payment";
  key: string;
  loanName: string;
  local: LoanPaymentRecord[];
  backup: LoanPaymentRecord[];
}

export type PortfolioImportConflict = SaleImportConflict | LoanPaymentImportConflict;

export type PortfolioImportResult =
  | { status: "saved" | "failed" }
  | { status: "review"; conflicts: PortfolioImportConflict[] };

export class PortfolioImportReviewRequired extends Error {
  constructor(readonly conflicts: PortfolioImportConflict[]) {
    super("請先核對備份中的交易紀錄");
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

function reviewKey(kind: SaleImportConflict["kind"], local: SaleTransaction[], backup: SaleTransaction[], capacity?: number) {
  return JSON.stringify([kind, capacity, ...[local, backup].map((sales) =>
    sales.map((record) => [record.id, record.updatedAt ?? record.createdAt]).sort()
  )]);
}

export function isPortfolioImportChoiceAllowed(conflict: PortfolioImportConflict, choice?: PortfolioImportChoices[string]): boolean {
  if (conflict.kind === "loan_payment") {
    if (!Array.isArray(choice) || !choice.length) return false;
    const paymentIds = new Set([...conflict.local, ...conflict.backup].map((payment) => payment.id));
    return new Set(choice).size === choice.length && choice.every((id) => paymentIds.has(id));
  }
  if (choice === "local") return conflict.canKeepLocal !== false;
  if (choice === "backup") return conflict.canKeepBackup !== false;
  return choice === "both" && conflict.canKeepBoth;
}

function withoutSales(state: PortfolioStorage, rejected: Set<string>) {
  const affectedHoldings = new Set<string>();
  if (!rejected.size) return { sales: state.sales, transactions: state.transactions, affectedHoldings };
  const { linked } = linkSaleEvents(state.sales, state.transactions);
  return {
    sales: state.sales.filter((sale) => {
      if (!rejected.has(sale.id)) return true;
      affectedHoldings.add(sale.holdingId);
      return false;
    }),
    transactions: state.transactions.filter((event) =>
      !rejected.has(event.saleId ?? linked.get(event.id)?.id ?? "")
    ),
    affectedHoldings,
  };
}

function acquisitionVersions(state: PortfolioStorage) {
  return new Map(state.transactions
    .filter((event) => event.type === "buy" || event.type === "opening_balance")
    .map((event) => [event.holdingId, event.updatedAt]));
}

function compareImportReviews(a: RecordImportReview, b: RecordImportReview) {
  return a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id);
}

function excludedByReviews(reviews: RecordImportReview[]) {
  const excluded = new Set<string>();
  for (const review of reviews) {
    for (const id of review.includedIds) excluded.delete(id);
    for (const id of review.excludedIds) excluded.add(id);
  }
  return excluded;
}

function appendImportReview(reviews: RecordImportReview[], includedIds: string[], excludedIds: string[]) {
  const previous = reviews.at(-1);
  const previousTime = previous ? Date.parse(previous.reviewedAt) : 0;
  // 跨裝置時鐘有偏差時，本次核對仍應排在已知的決定之後。
  const reviewedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
  includedIds.sort();
  excludedIds.sort();
  const id = JSON.stringify([includedIds, excludedIds]);
  const existing = reviews.findIndex((review) => review.id === id);
  if (existing >= 0) reviews.splice(existing, 1);
  reviews.push({ id, reviewedAt, includedIds, excludedIds });
}

function reviewLoanPayments(
  loan: Loan,
  localIds: Set<string> | undefined,
  backupIds: Set<string> | undefined,
  choices: PortfolioImportChoices,
  conflicts: LoanPaymentImportConflict[]
): Loan {
  if (!loan.paymentHistory?.length) return loan;
  const reviews = [...(loan.paymentImportReviews ?? [])].sort(compareImportReviews);
  const excludedIds = excludedByReviews(reviews);

  const groups = new Map<string, { local: LoanPaymentRecord[]; backup: LoanPaymentRecord[] }>();
  if (localIds?.size && backupIds?.size) {
    for (const payment of loan.paymentHistory) {
      if (excludedIds.has(payment.id)) continue;
      const local = localIds.has(payment.id);
      if (local === backupIds.has(payment.id)) continue;
      const key = JSON.stringify([payment.paymentDate, payment.principalPaid, payment.interestPaid,
        payment.feePaid, payment.subsidyReceived, payment.remainingPrincipalAfter]);
      const group = groups.get(key) ?? { local: [], backup: [] };
      group[local ? "local" : "backup"].push(payment);
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    if (!group.local.length || !group.backup.length) continue;
    const ids = [...group.local, ...group.backup].map((payment) => payment.id).sort();
    // 用完整紀錄核對選擇，避免另一個分頁更新備份內容後沿用舊確認。
    const key = JSON.stringify(["loan_payment", loan.id, ...[group.local, group.backup].map((payments) =>
      [...payments].sort((a, b) => a.id.localeCompare(b.id))
    )]);
    const conflict: LoanPaymentImportConflict = { kind: "loan_payment", key, loanName: loan.name, ...group };
    conflicts.push(conflict);
    const choice = choices[key];
    if (!Array.isArray(choice) || !isPortfolioImportChoiceAllowed(conflict, choice)) continue;
    const includedIds = [...choice];
    const included = new Set(includedIds);
    const excluded = ids.filter((id) => !included.has(id));
    appendImportReview(reviews, includedIds, excluded);
    for (const id of excluded) excludedIds.add(id);
  }
  const payments = loan.paymentHistory.filter((payment) => !excludedIds.has(payment.id));
  return reviews.length ? {
    ...loan, paymentHistory: payments.length ? payments : undefined, paymentImportReviews: reviews,
  } : loan;
}

function mergeLoans(current: PortfolioStorage, incoming: PortfolioStorage, choices: PortfolioImportChoices = {}) {
  const all = [...current.loans, ...incoming.loans];
  const aliases = new Map<string, string>();
  const canonicalId = (id: string) => {
    let result = id;
    while (aliases.has(result)) result = aliases.get(result)!;
    return result;
  };
  // 每個清償紀錄只允許一次重新追蹤。同一階段在不同裝置可有不同 id。
  // 父階段合併後，子階段也可能成為同一階段，須重新比對直到沒有新別名。
  let changed = true;
  while (changed) {
    changed = false;
    const restartByParent = new Map<string, string>();
    for (const loan of all) {
      if (!loan.restartedFromLoanId) continue;
      const parent = canonicalId(loan.restartedFromLoanId);
      const id = canonicalId(loan.id);
      if (id === parent) continue;
      const existing = restartByParent.get(parent);
      if (!existing) {
        restartByParent.set(parent, id);
      } else if (canonicalId(existing) !== id) {
        const [preferred, alternate] = [canonicalId(existing), id].sort();
        aliases.set(alternate, preferred);
        restartByParent.set(parent, preferred);
        changed = true;
      }
    }
  }

  const remap = (loan: Loan): Loan => {
    const id = canonicalId(loan.id);
    const parent = loan.restartedFromLoanId ? canonicalId(loan.restartedFromLoanId) : undefined;
    return id === loan.id && parent === loan.restartedFromLoanId ? loan : {
      ...loan, id, restartedFromLoanId: parent === id ? undefined : parent,
    };
  };
  const revisions = mergeRecords(current.loanRevisions, incoming.loanRevisions).map((revision) => ({
    ...revision, loanId: canonicalId(revision.loanId), previous: remap(revision.previous),
  }));
  const mergePair = (local: Loan, backup: Loan): Loan => {
    const localVersion = local.contractUpdatedAt ?? local.updatedAt;
    const backupVersion = backup.contractUpdatedAt ?? backup.updatedAt;
    // 合約時間相同時保留本機，避免只同步了事件就取代合約資料。
    const contract = backupVersion > localVersion ? backup : local;
    const balanceByDate = new Map((local.balanceHistory ?? []).map((entry) => [entry.effectiveDate, entry]));
    for (const entry of backup.balanceHistory ?? []) {
      const existing = balanceByDate.get(entry.effectiveDate);
      if (!existing || entry.recordedAt > existing.recordedAt) balanceByDate.set(entry.effectiveDate, entry);
    }
    const balanceHistory = [...balanceByDate.values()]
      .filter((entry) => entry.effectiveDate >= contract.trackingStartDate)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const rateHistory = mergeRecords(local.rateHistory ?? [], backup.rateHistory ?? [])
      .filter((entry) => entry.effectiveDate >= contract.trackingStartDate)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt));
    const paymentHistory = mergeRecords(local.paymentHistory ?? [], backup.paymentHistory ?? [],
      (payment) => payment.installmentAssignedAt ?? payment.createdAt)
      .filter((entry) => entry.paymentDate >= contract.trackingStartDate)
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.createdAt.localeCompare(b.createdAt));
    const paymentImportReviews = mergeRecords(local.paymentImportReviews ?? [], backup.paymentImportReviews ?? [],
      (review) => review.reviewedAt);
    return {
      ...contract,
      updatedAt: backup.updatedAt > local.updatedAt ? backup.updatedAt : local.updatedAt,
      balanceHistory: balanceHistory.length ? balanceHistory : undefined,
      rateHistory: rateHistory.length ? rateHistory : undefined,
      paymentHistory: paymentHistory.length ? paymentHistory : undefined,
      paymentImportReviews: paymentImportReviews.length ? paymentImportReviews : undefined,
    };
  };

  const merged = new Map<string, Loan>();
  const closed = new Map<string, Loan>();
  const paymentIds = { local: new Map<string, Set<string>>(), backup: new Map<string, Set<string>>() };
  for (const [side, state] of [["local", current], ["backup", incoming]] as const) {
    for (const original of state.loans) {
      const loan = remap(original);
      if (loan.paymentHistory?.length) {
        const ids = paymentIds[side].get(loan.id) ?? new Set<string>();
        for (const payment of loan.paymentHistory) ids.add(payment.id);
        paymentIds[side].set(loan.id, ids);
      }
      const contractRevisions = state.loanRevisions.filter((revision) => revision.loanId === original.id)
        .map((revision) => revision.correctedAt);
      const events = [
        ...(loan.balanceHistory ?? []).map((entry) => entry.recordedAt),
        ...(loan.rateHistory ?? []).map((entry) => entry.createdAt),
        ...(loan.paymentHistory ?? []).flatMap((entry) => [entry.createdAt, entry.installmentAssignedAt]),
      ];
      const legacy = [...contractRevisions, events.includes(loan.updatedAt) ? loan.createdAt : loan.updatedAt].sort().at(-1)!;
      const versioned = { ...loan, contractUpdatedAt: loan.contractUpdatedAt ?? legacy };
      const existing = merged.get(loan.id);
      merged.set(loan.id, existing ? mergePair(existing, versioned) : versioned);
      if (loan.status !== "active" && loan.closedAt &&
          (!closed.has(loan.id) || versioned.contractUpdatedAt > closed.get(loan.id)!.contractUpdatedAt!)) {
        closed.set(loan.id, versioned);
      }
    }
  }
  const loans = [...merged.values()];
  const restartedParents = new Set(loans.map((loan) => loan.restartedFromLoanId));
  const conflicts: LoanPaymentImportConflict[] = [];
  return {
    loans: loans.map((loan) => {
      const prior = closed.get(loan.id);
      const versionedLoan = loan.status === "active" && prior && restartedParents.has(loan.id)
        ? { ...loan, status: prior.status, closedAt: prior.closedAt }
        : loan;
      return reviewLoanPayments(versionedLoan, paymentIds.local.get(loan.id), paymentIds.backup.get(loan.id), choices, conflicts);
    }),
    loanRevisions: revisions,
    conflicts,
  };
}

/** 以修改時間合併可編輯紀錄；同時刻或無修改時間的衝突保留本機。 */
export function mergePortfolioStorage(
  local: PortfolioStorage,
  backup: PortfolioStorage,
  choices: PortfolioImportChoices = {}
): PortfolioStorage {
  const current = repairCorporateActionPriceHistory(local);
  const incoming = repairCorporateActionPriceHistory(backup);
  const removals = new Map<string, HoldingRemoval>();
  for (const removal of [...(current.holdingRemovals ?? []), ...(incoming.holdingRemovals ?? [])]) {
    const previous = removals.get(removal.holding.id);
    if (!previous || removal.removedOn < previous.removedOn ||
        (removal.removedOn === previous.removedOn && removal.removedAt < previous.removedAt)) {
      removals.set(removal.holding.id, removal);
    }
  }
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
  const localVersions = acquisitionVersions(current);
  const backupVersions = acquisitionVersions(incoming);
  const positionVersion = (holding: Holding, versions: Map<string, string>) =>
    holding.positionUpdatedAt ?? versions.get(holding.id) ??
      (holding.lastUpdatedAt && holding.updatedAt <= holding.lastUpdatedAt ? holding.createdAt : holding.updatedAt);
  const sources = new Map<Holding, PortfolioStorage>();
  const positions = new Map(current.holdings.map((holding) => [holding.id, holding]));
  for (const holding of current.holdings) sources.set(holding, current);
  for (const holding of incoming.holdings) {
    sources.set(holding, incoming);
    const existing = currentById.get(holding.id);
    if (!existing || positionVersion(holding, backupVersions) > positionVersion(existing, localVersions)) {
      positions.set(holding.id, holding);
    }
  }
  const selectedHoldings = [...positions.values()];
  const incomingById = new Map(incoming.holdings.map((holding) => [holding.id, holding]));
  const selectedKeys = new Map(selectedHoldings.map((holding) => [holding.id, holdingGroupKey(holding)]));
  const selectedById = new Map(selectedHoldings.map((holding) => [holding.id, holding]));
  const mergedSales = mergeRecords(current.sales, incoming.sales, (sale) => sale.updatedAt ?? sale.createdAt);
  const saleImportReviews = mergeRecords(current.saleImportReviews ?? [], incoming.saleImportReviews ?? [],
    (review) => review.reviewedAt).sort(compareImportReviews);
  const dropped = excludedByReviews(saleImportReviews);
  const isRetained = (sale: SaleTransaction) => !dropped.has(sale.id);

  const duplicateGroups = duplicateSaleGroups(current.sales.filter(isRetained), incoming.sales.filter(isRetained));
  const duplicates: SaleImportConflict[] = duplicateGroups.map((group) => {
    const id = group.local[0].holdingId;
    const holding = selectedById.get(id);
    const fromCurrent = holding && currentById.get(id) === holding;
    const source = fromCurrent ? current : incoming;
    const sourceIds = fromCurrent ? currentSalesIds : incomingSalesIds;
    const actions = holding ? holdingActions(corporateActions, holding) : [];
    const sourceActions = holding ? holdingActions(source.corporateActions, holding) : [];
    const trades = mergedSales.filter((sale) => sale.holdingId === id);
    const addedQuantity = trades.reduce((sum, sale) => {
      const wasSold = sourceIds.has(sale.id);
      if (wasSold === isRetained(sale)) return sum;
      const quantity = sale.quantity * shareAdjustmentAfter(actions, sale.sellDate);
      return wasSold ? sum - quantity : sum + quantity;
    }, 0);
    // 使用各筆成交日期的股數換算，並預留同一批次其他備份成交。
    const canKeepBoth = Boolean(holding && currentById.has(id) && incomingIds.has(id) &&
      !trades.some((sale) => sale.positionClosed && isRetained(sale)) &&
      addedQuantity <= holding.quantity * shareAdjustmentAfter(actions, holding.buyDate) /
        shareAdjustmentAfter(sourceActions, holding.buyDate));
    return {
      ...group,
      kind: "duplicate",
      canKeepBoth,
      key: reviewKey("duplicate", group.local, group.backup),
    };
  });
  const { conflicts: paymentConflicts, ...mergedLoans } = mergeLoans(current, incoming, choices);
  const initialConflicts = [...duplicates, ...paymentConflicts];
  if (initialConflicts.some((conflict) => !isPortfolioImportChoiceAllowed(conflict, choices[conflict.key]))) {
    throw new PortfolioImportReviewRequired(initialConflicts);
  }

  const decide = (conflict: SaleImportConflict) => {
    const choice = choices[conflict.key];
    const localIds = conflict.local.map((sale) => sale.id);
    const backupIds = conflict.backup.map((sale) => sale.id);
    const included = choice === "local" ? localIds : choice === "backup" ? backupIds : [...localIds, ...backupIds];
    const excluded = choice === "local" ? backupIds : choice === "backup" ? localIds : [];
    appendImportReview(saleImportReviews, included, excluded);
    for (const id of excluded) dropped.add(id);
  };
  for (const conflict of duplicates) decide(conflict);
  const provisionalSales = mergedSales.filter(isRetained);
  const oversold: SaleImportConflict[] = [];
  const archivedOpenings = new Map(mergeRecords(
    adjustedTransactions(current, corporateActions),
    adjustedTransactions(incoming, corporateActions),
    (event) => event.updatedAt
  ).filter((event) => event.type === "buy").map((event) => [event.holdingId, event]));
  for (const id of new Set(provisionalSales.map((sale) => sale.holdingId))) {
    const records = provisionalSales.filter((sale) => sale.holdingId === id);
    const localOnly = records.filter((sale) => !incomingSalesIds.has(sale.id));
    const backupOnly = records.filter((sale) => !currentSalesIds.has(sale.id));
    if (localOnly.length === 0 && backupOnly.length === 0) continue;
    const holding = selectedById.get(id);
    const instrument = holding ?? { ...records[0], id };
    const actions = holdingActions(corporateActions, instrument);
    const sumQuantity = (sales: SaleTransaction[]) => sales.reduce((sum, record) =>
      sum + record.quantity * shareAdjustmentAfter(actions, record.sellDate), 0
    );
    const total = sumQuantity(records);
    let capacity: number;
    if (holding) {
      const source = sources.get(holding)!;
      const originalBasis = holdingActions(source.corporateActions, holding);
      const factor = shareAdjustmentAfter(actions, holding.buyDate) / shareAdjustmentAfter(originalBasis, holding.buyDate);
      capacity = holding.quantity * factor + sumQuantity(source.sales.filter((sale) => sale.holdingId === id));
    } else {
      capacity = archivedOpenings.get(id)?.quantity ?? Math.max(
        sumQuantity(current.sales.filter((sale) => sale.holdingId === id)),
        sumQuantity(incoming.sales.filter((sale) => sale.holdingId === id)),
      );
    }
    const within = (quantity: number) => quantity <= capacity + 8 * Number.EPSILON * Math.max(capacity, quantity);
    if (within(total)) continue;
    oversold.push({
      kind: "oversold",
      key: reviewKey("oversold", localOnly, backupOnly, capacity),
      local: localOnly,
      backup: backupOnly,
      mergedQuantity: total,
      capacity,
      canKeepBoth: false,
      canKeepLocal: within(total - sumQuantity(backupOnly)),
      canKeepBackup: within(total - sumQuantity(localOnly)),
    });
  }
  if (oversold.some((conflict) => !isPortfolioImportChoiceAllowed(conflict, choices[conflict.key]))) {
    throw new PortfolioImportReviewRequired([...initialConflicts, ...oversold]);
  }
  for (const conflict of oversold) decide(conflict);
  const currentTrades = withoutSales(current, dropped);
  const incomingTrades = withoutSales(incoming, dropped);
  const sales = mergedSales.filter(isRetained);
  // 來源若已放棄一筆賣出，僅憑該側沒有持倉，無法判斷保留的成交是否已出清。
  const currentClosed = new Set([
    ...currentTrades.sales.map((sale) => sale.holdingId),
    ...currentTrades.transactions.filter((event) => event.type === "sell").map((event) => event.holdingId),
  ].filter((id) => !currentById.has(id) && !currentTrades.affectedHoldings.has(id)));

  const salesByHolding = new Map<string, SaleTransaction[]>();
  for (const sale of sales) {
    const records = salesByHolding.get(sale.holdingId) ?? [];
    records.push(sale);
    salesByHolding.set(sale.holdingId, records);
  }

  const mergedCosts = new Map<string, { holding: Holding; cost: number; actions: CorporateActionRecord[] }>();
  const holdings = selectedHoldings.flatMap((holding) => {
    const holdingSales = salesByHolding.get(holding.id) ?? [];
    const closedInBackup = !incomingIds.has(holding.id) && !incomingTrades.affectedHoldings.has(holding.id) &&
      holdingSales.some((sale) => incomingSalesIds.has(sale.id) &&
        sale.positionClosed === undefined && sale.createdAt >= holding.updatedAt);
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
    const restoredQuantity = source.sales.reduce((quantity, sale) =>
      sale.holdingId === holding.id && dropped.has(sale.id)
        ? quantity + sale.quantity * shareAdjustmentAfter(mergedBasis, sale.sellDate)
        : quantity, 0
    );
    const quantity = holding.quantity * quantityRatio + restoredQuantity - soldQuantity;
    const sourceActions = new Set(sourceBasis.map((action) => action.sourceEventId));
    const costReduction = mergedBasis.reduce((total, action) => {
      if (sourceActions.has(action.sourceEventId) || action.effectiveDate <= holding.buyDate) return total;
      const returned = (action.cashReturnPerShare ?? 0) / corporateActionAdjustmentRatio(action);
      return total + returned / shareAdjustmentAfter(mergedBasis, action.effectiveDate);
    }, 0);
    const cost = Math.max(0, holding.buyPrice / quantityRatio - costReduction);
    mergedCosts.set(holding.id, { holding, cost, actions: mergedBasis });
    if (removals.has(holding.id) || currentClosed.has(holding.id) || closedInBackup ||
        holdingSales.some((sale) => sale.positionClosed === true) ||
        quantity <= Number.EPSILON * Math.max(holding.quantity, soldQuantity)) return [];
    const sameInstrument = (candidate?: Holding): candidate is Holding =>
      !!candidate && holdingGroupKey(candidate) === holdingGroupKey(holding);
    const currentQuote = currentById.get(holding.id);
    const backupQuote = incomingById.get(holding.id);
    const quote = sameInstrument(backupQuote) && backupQuote.currentPrice !== undefined &&
      (!sameInstrument(currentQuote) || currentQuote.currentPrice === undefined ||
        (backupQuote.priceDate ?? "") > (currentQuote.priceDate ?? ""))
      ? backupQuote
      : sameInstrument(currentQuote) && currentQuote.currentPrice !== undefined ? currentQuote : holding;
    const quoteBasis = (sources.get(quote) ?? source).corporateActions.filter(matchesHolding);
    const priceRatio = quote.priceDate
      ? shareAdjustmentAfter(quoteBasis, quote.priceDate) / shareAdjustmentAfter(mergedBasis, quote.priceDate)
      : 1;
    return [{
      ...holding,
      quantity,
      buyPrice: cost,
      positionUpdatedAt: positionVersion(holding, fromCurrent ? localVersions : backupVersions),
      currentPrice: quote.currentPrice === undefined ? undefined : quote.currentPrice * priceRatio,
      priceDate: quote.priceDate,
      priceSource: quote.priceSource,
      lastUpdatedAt: quote.lastUpdatedAt,
      lastError: quote.lastError,
    }];
  });

  const localSales = new Map(current.sales.map((sale) => [sale.id, sale]));
  const repricedSales = sales.map((sale) => {
    const cost = mergedCosts.get(sale.holdingId);
    if (!cost || holdingGroupKey({ ...sale, id: sale.holdingId }) !== holdingGroupKey(cost.holding)) return sale;
    const saleWasLocal = localSales.get(sale.id) === sale;
    const costIsLocal = currentById.get(sale.holdingId) === cost.holding;
    if (saleWasLocal === costIsLocal) return sale;
    const version = positionVersion(cost.holding, costIsLocal ? localVersions : backupVersions);
    const salePosition = (saleWasLocal ? currentById : incomingById).get(sale.holdingId);
    const acquisition = saleWasLocal ? localVersions : backupVersions;
    const salePositionVersion = salePosition
      ? positionVersion(salePosition, acquisition) : acquisition.get(sale.holdingId);
    if (!salePositionVersion || version <= salePositionVersion) return sale;
    const buyPrice = Math.max(0, costOnDate(cost.cost, cost.actions, sale.sellDate));
    if (buyPrice === sale.buyPrice) return sale;
    const costBasis = buyPrice * sale.quantity;
    const previousTime = Date.parse(sale.updatedAt ?? sale.createdAt);
    const correctionTime = Date.parse(version);
    const updatedAt = Number.isFinite(correctionTime)
      ? new Date(Math.max(correctionTime, Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString()
      : sale.updatedAt;
    return { ...sale, buyPrice, costBasis, realizedPnl: sale.realizedPnl + (sale.costBasis - costBasis), updatedAt };
  });

  const transactions = mergeManualDividends(mergeRecords(
    adjustedTransactions({ ...current, transactions: currentTrades.transactions }, corporateActions),
    adjustedTransactions({ ...incoming, transactions: incomingTrades.transactions }, corporateActions),
    (event) => event.updatedAt
  ));
  const pnlEventDates = new Map<string, string[]>();
  for (const event of transactions) {
    if (event.type !== "sell" && event.type !== "cash_dividend") continue;
    const dates = pnlEventDates.get(event.holdingId) ?? [];
    dates.push(event.date);
    pnlEventDates.set(event.holdingId, dates);
  }
  const changedPrices = { current: new Set<string>(), incoming: new Set<string>() };
  const earliest = priceHistoryStartDate();
  let priceHistory: PortfolioStorage["priceHistory"] = {};
  for (const holdingId of new Set([...Object.keys(current.priceHistory), ...Object.keys(incoming.priceHistory)])) {
    const removed = removals.get(holdingId);
    const instrument = removed ? holdingGroupKey(removed.holding)
      : selectedKeys.get(holdingId) ?? currentKeys.get(holdingId) ?? incomingKeys.get(holdingId);
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
    const imported = rebase(incoming, incomingKeys.get(holdingId));
    if (existing.length) priceHistory[holdingId] = existing;
    const existingDates = new Set(existing.map((point) => point.date));
    const added = imported.filter((point) => !existingDates.has(point.date));
    if (added.length) priceHistory = mergePriceHistory(priceHistory, holdingId, added);
    if (!instrument || instrument.startsWith("property:")) continue;
    const points = priceHistory[holdingId] ?? [];
    const dates = pnlEventDates.get(holdingId) ?? [];
    for (const date of pnlDatesUsingDifferentPrices(points, existing, dates, earliest)) changedPrices.current.add(date);
    for (const date of pnlDatesUsingDifferentPrices(points, imported, dates, earliest)) changedPrices.incoming.add(date);
  }

  const dailySummaries = mergeDailyPnlSummaries(current, incoming, repricedSales, corporateActions, changedPrices);
  for (const [id, removal] of removals) {
    for (const point of priceHistory[id] ?? []) {
      if (point.date >= removal.removedOn) delete dailySummaries[point.date];
    }
  }
  const currentHasData = hasPortfolioData(current);
  const result: PortfolioStorage = {
    version: 2,
    holdings: holdings.map((holding) => restoreLatestQuote(holding, priceHistory[holding.id])),
    holdingRemovals: [...removals.values()],
    ...mergedLoans,
    sales: repricedSales,
    ...(saleImportReviews.length ? { saleImportReviews } : {}),
    corporateActions,
    transactions,
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
  const reconciled = reconcileCorporateDividends(result);
  for (const date of reconciled.dates) delete dailySummaries[date];
  const recalculate = [...new Set([...changedPrices.current, ...changedPrices.incoming])]
    .filter((date) => !dailySummaries[date]);
  return persistPnlSummariesForDates(reconciled.storage, recalculate);
}

export function applyImportMode(
  current: PortfolioStorage,
  incoming: PortfolioStorage,
  mode: PortfolioImportMode,
  choices?: PortfolioImportChoices
): PortfolioStorage {
  if (mode === "replace") {
    const { loans, loanRevisions } = mergeLoans(incoming, { ...incoming, loans: [], loanRevisions: [] });
    return {
      ...incoming,
      loans,
      loanRevisions,
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
