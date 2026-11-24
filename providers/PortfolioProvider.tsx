"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { todayIsoDate } from "@/lib/date/iso-date";
import { CloudMergeModal } from "@/components/auth/CloudMergeModal";
import { CloudUploadPromptModal } from "@/components/auth/CloudUploadPromptModal";
import {
  clearUploadPromptDismissed,
  isUploadPromptDismissed,
  setUploadPromptDismissed,
} from "@/lib/client/upload-prompt-storage";
import {
  canImportHistory,
  fetchHistoryForHoldings,
  type PriceHistoryRange,
} from "@/lib/client/holding-history";
import { fetchCorporateActions } from "@/lib/client/corporate-actions-api";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";
import {
  fetchBatchPriceUpdate,
  fetchPriceUpdate,
  holdingToUpdateRequest,
  isPriceError,
} from "@/lib/client/price-api";
import {
  fetchCloudPortfolio,
  pushCloudPortfolio,
} from "@/lib/client/portfolio-sync-api";
import type { ChartRange } from "@/lib/portfolio/chart-date-range";
import { holdingGroupKey } from "@/lib/portfolio/holding-groups";
import { supportsAutoPriceUpdate } from "@/lib/portfolio/asset-labels";
import {
  enrichHoldings,
  computePortfolioSummary,
  sortSalesByDateDesc,
} from "@/lib/portfolio/calculations";
import {
  computePortfolioExposure,
  type PortfolioExposureSummary,
} from "@/lib/portfolio/exposure";
import { calculatePortfolioLoanSummary } from "@/lib/loans/calculations";
import { calculatePortfolioLoanRiskSummary } from "@/lib/loans/risk";
import { buildLoanReminders } from "@/lib/loans/reminders";
import {
  buildPortfolioPnlBreakdowns,
  type PortfolioPnlBreakdowns,
} from "@/lib/portfolio/pnl-breakdown";
import { applyImportMode } from "@/lib/storage/portfolio-export";
import type { PortfolioImportMode } from "@/lib/storage/portfolio-export";
import {
  defaultPortfolioStorage,
  hasPortfolioData,
  normalizePortfolioStorage,
} from "@/lib/storage/parse-portfolio";
import {
  addCashDividend,
  addHolding,
  applyCorporateAction,
  applyManualCorporateAction,
  applyManualCorporateActionToGroup,
  applyPriceUpdate,
  editHolding,
  loadPortfolio,
  removeHolding,
  repairCorporateActionPriceHistory,
  sellHoldings,
  savePortfolio,
  updateHolding,
  updateSettings,
} from "@/lib/storage/portfolio-store";
import { applyHistoryResults, applyQuoteResults, hasUnchangedQuote, isSamePriceTarget } from "@/lib/storage/portfolio-price-results";
import {
  addLoan as addLoanToStorage,
  editLoan as editLoanInStorage,
  recordLoanBalance as recordLoanBalanceInStorage,
  recordLoanPayment as recordLoanPaymentInStorage,
  recordLoanRateChange as recordLoanRateChangeInStorage,
  setLoanStatus as setLoanStatusInStorage,
} from "@/lib/storage/loan-store";
import type {
  CreateHoldingInput,
  AssetAllocationTargets,
  CashDividendInput,
  EditHoldingInput,
  Holding,
  HoldingWithMetrics,
  ManualCorporateActionInput,
  PortfolioSettings,
  PortfolioStorage,
  PortfolioSummary,
  SaleTransaction,
  SellHoldingInput,
} from "@/lib/types/holding";
import type {
  CreateLoanInput,
  CreateLoanPaymentInput,
  CreateLoanRateChangeInput,
  EditLoanInput,
  Loan,
  LoanReminder,
  LoanStatus,
  PortfolioLoanSummary,
  PortfolioLoanRiskSummary,
} from "@/lib/types/loan";
import type {
  UiPreferences,
  UiTheme,
} from "@/lib/types/ui-preferences";

import type { CloudPortfolioEnvelope } from "@/lib/types/portfolio-sync";

type UpdateStatus = "idle" | "loading" | "partial" | "done" | "error";
export type StorageMode = "anonymous" | "local" | "cloud";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";
export type CorporateActionStatus = UpdateStatus;

/**
 * 雲端持倉仍是資料主體，但介面偏好採最後寫入者優先。
 * 這可避免使用者套用版面後立刻重新整理，尚未完成的 PUT 被舊雲端設定蓋回。
 */
function preserveNewerUiPreferences(
  base: PortfolioStorage,
  candidate: PortfolioStorage
): PortfolioStorage {
  const baseUpdatedAt = base.settings.uiPreferences?.updatedAt;
  const candidateUpdatedAt = candidate.settings.uiPreferences?.updatedAt;

  if (
    !candidateUpdatedAt ||
    (baseUpdatedAt && candidateUpdatedAt <= baseUpdatedAt)
  ) {
    return base;
  }

  return {
    ...base,
    settings: {
      ...base.settings,
      theme: candidate.settings.theme,
      uiPreferences: candidate.settings.uiPreferences,
    },
  };
}

function comparablePortfolio(portfolio: PortfolioStorage): string {
  const normalized = normalizePortfolioStorage(portfolio) ?? portfolio;
  const settings = { ...normalized.settings, theme: undefined, uiPreferences: undefined };
  return JSON.stringify({ ...normalized, settings });
}

interface PortfolioContextValue {
  ready: boolean;
  storageMode: StorageMode;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  holdings: HoldingWithMetrics[];
  loans: Loan[];
  loanSummary: PortfolioLoanSummary;
  loanRiskSummary: PortfolioLoanRiskSummary;
  loanReminders: LoanReminder[];
  sales: SaleTransaction[];
  summary: PortfolioSummary;
  exposure: PortfolioExposureSummary;
  pnlBreakdowns: PortfolioPnlBreakdowns;
  storage: PortfolioStorage;
  batchStatus: UpdateStatus;
  batchMessage: string | null;
  corporateActionStatus: CorporateActionStatus;
  corporateActionMessage: string | null;
  pendingCorporateActions: CorporateActionEvent[];
  latestAddedHoldingId: string | null;
  dismissAddedHolding: () => void;
  add: (
    input: CreateHoldingInput,
    options?: { initialPrice?: number; initialPriceDate?: string }
  ) => string | null;
  edit: (input: EditHoldingInput) => void;
  sell: (input: SellHoldingInput | SellHoldingInput[]) => void;
  addDividend: (input: CashDividendInput) => void;
  remove: (id: string) => void;
  addLoan: (input: CreateLoanInput) => string | null;
  editLoan: (input: EditLoanInput) => void;
  updateLoanBalance: (
    id: string,
    balance: number,
    effectiveDate: string
  ) => void;
  recordLoanPayment: (id: string, input: CreateLoanPaymentInput) => void;
  recordLoanRateChange: (id: string, input: CreateLoanRateChangeInput) => void;
  setLoanStatus: (
    id: string,
    status: LoanStatus,
    effectiveDate: string
  ) => void;
  setManualPrice: (id: string, price: number, priceDate: string) => void;
  updateOne: (id: string) => Promise<boolean>;
  updateAll: () => Promise<void>;
  scanCorporateActions: () => Promise<void>;
  applyDetectedCorporateAction: (event: CorporateActionEvent) => void;
  applyManualAction: (input: ManualCorporateActionInput) => void;
  applyManualActionToGroup: (
    groupKey: string,
    input: Omit<ManualCorporateActionInput, "holdingId">
  ) => void;
  refreshPortfolioForRange: (range: PriceHistoryRange) => Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
  importPriceHistory: (
    groupKey: string,
    range: ChartRange
  ) => Promise<{ ok: boolean; count?: number; startDate?: string; endDate?: string; error?: string }>;
  importFundHistory: (
    groupKey: string,
    range: ChartRange
  ) => Promise<{ ok: boolean; count?: number; startDate?: string; endDate?: string; error?: string }>;
  setAutoUpdate: (enabled: boolean) => void;
  setExposureSettings: (
    patch: Pick<PortfolioSettings, "netAssets">
  ) => void;
  setAllocationTargets: (targets: AssetAllocationTargets) => void;
  setThemePreference: (theme: UiTheme) => void;
  applyUiPreferences: (theme: UiTheme, preferences: UiPreferences) => void;
  /** 從 JSON 備份匯入（取代或合併） */
  importPortfolio: (
    incoming: PortfolioStorage,
    mode: PortfolioImportMode
  ) => void;
  /** 強制從雲端重新載入（新裝置／同步異常時使用） */
  refreshFromCloud: () => Promise<boolean>;
}

type CloudChoice = { version: string | null; remote: PortfolioStorage | null };

interface CloudSyncQueue {
  version: string | null;
  pending: PortfolioStorage | null;
  inFlight: boolean;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: authStatus } = useSession();

  const [storage, setStorageState] = useState<PortfolioStorage | null>(null);
  const storageRef = useRef<PortfolioStorage | null>(null);
  const setStorage = useCallback((next: PortfolioStorage) => {
    storageRef.current = next;
    setStorageState(next);
  }, []);
  const [storageMode, setStorageMode] = useState<StorageMode>("anonymous");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<UpdateStatus>("idle");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [corporateActionStatus, setCorporateActionStatus] =
    useState<CorporateActionStatus>("idle");
  const [corporateActionMessage, setCorporateActionMessage] = useState<
    string | null
  >(null);
  const [detectedCorporateActions, setDetectedCorporateActions] = useState<
    CorporateActionEvent[]
  >([]);
  const [cloudChoice, setCloudChoice] = useState<CloudChoice | null>(null);
  const [latestAddedHoldingId, setLatestAddedHoldingId] = useState<string | null>(null);
  const dismissAddedHolding = useCallback(() => setLatestAddedHoldingId(null), []);
  const [initializedAccount, setInitializedAccount] = useState<string | null>(null);

  const sessionUserId = authStatus === "authenticated" ? session?.user?.id : undefined;
  const account = sessionUserId ?? "";
  const cloudQueueRef = useRef<CloudSyncQueue | null>(null);
  const cloudReadRef = useRef<symbol | null>(null);
  const initGenerationRef = useRef(0);
  const priceBatchRef = useRef<symbol | null>(null);
  const priceGenerationRef = useRef(0);
  const invalidatePriceRequests = useCallback(() => {
    priceGenerationRef.current++;
    priceBatchRef.current = null;
    setBatchStatus("idle");
    setBatchMessage(null);
  }, []);

  const pushCloudSync = useCallback(async (next: PortfolioStorage) => {
    const queue = cloudQueueRef.current;
    if (!queue) return;
    queue.pending = next;
    if (queue.inFlight) return;

    queue.inFlight = true;
    setSyncStatus("syncing");
    setSyncMessage(null);
    try {
      while (queue.pending && cloudQueueRef.current === queue) {
        const pending = queue.pending;
        queue.pending = null;
        const result = await pushCloudPortfolio(pending, queue.version);
        if (cloudQueueRef.current !== queue) return;

        if (result.ok) {
          queue.version = result.updatedAt;
          continue;
        }
        if (result.status === 409) {
          // 偵測到別台裝置的寫入時，保留本機最新變更並讓使用者選擇版本。
          cloudQueueRef.current = null;
          setStorageMode("local");
          setSyncStatus("idle");
          setSyncMessage("發現另一份雲端資料，請選擇要使用的版本。");
          setCloudChoice({
            version: result.remote?.updatedAt ?? null,
            remote: result.remote?.portfolio ?? null,
          });
        } else {
          setSyncStatus("error");
          setSyncMessage(result.error);
        }
        return;
      }
      if (cloudQueueRef.current === queue) setSyncStatus("synced");
    } finally {
      queue.inFlight = false;
    }
  }, []);

  const applyStorage = useCallback(
    (next: PortfolioStorage, options?: { skipCloud?: boolean }) => {
      setStorage(next);
      savePortfolio(next);
      if (!options?.skipCloud) void pushCloudSync(next);
    },
    [pushCloudSync, setStorage]
  );

  const connectCloud = useCallback((version: string | null) => {
    cloudQueueRef.current = { version, pending: null, inFlight: false };
    setStorageMode("cloud");
    setSyncStatus("synced");
    setSyncMessage(null);
    setCloudChoice(null);
  }, []);

  const loadCloudChoice = useCallback((remote: CloudPortfolioEnvelope | null, local: PortfolioStorage) => {
    const version = remote?.updatedAt ?? null;
    if (!remote || !hasPortfolioData(remote.portfolio)) {
      if (hasPortfolioData(local)) {
        setStorageMode("local");
        setCloudChoice({ version, remote: null });
        setSyncStatus("idle");
        setSyncMessage("本機已有資料，請確認是否開始同步。");
      } else {
        connectCloud(version);
        setSyncMessage("雲端同步已開啟");
      }
      return;
    }

    const sameData = comparablePortfolio(local) === comparablePortfolio(remote.portfolio);
    if (hasPortfolioData(local) && !sameData) {
      setStorageMode("local");
      setCloudChoice({ version, remote: remote.portfolio });
      setSyncStatus("idle");
      setSyncMessage("本機與雲端資料不同，請選擇要使用的版本。");
      return;
    }

    const repaired = repairCorporateActionPriceHistory(remote.portfolio);
    const reconciled = preserveNewerUiPreferences(repaired, local);
    if (!sameData) invalidatePriceRequests();
    applyStorage(reconciled, { skipCloud: true });
    connectCloud(version);
    if (reconciled !== remote.portfolio) void pushCloudSync(reconciled);
  }, [applyStorage, connectCloud, invalidatePriceRequests, pushCloudSync]);

  useEffect(() => {
    if (authStatus === "loading") return;
    const generation = ++initGenerationRef.current;
    cloudQueueRef.current = null;
    cloudReadRef.current = null;
    invalidatePriceRequests();
    setCloudChoice(null);
    setLatestAddedHoldingId(null);
    const local = loadPortfolio();
    setStorage(local);
    setSyncMessage(null);

    const cleanup = () => {
      initGenerationRef.current++;
      priceGenerationRef.current++;
      priceBatchRef.current = null;
      cloudQueueRef.current = null;
      cloudReadRef.current = null;
    };

    if (!sessionUserId || isUploadPromptDismissed(sessionUserId)) {
      setStorageMode(sessionUserId ? "local" : "anonymous");
      setSyncStatus("idle");
      setInitializedAccount(account);
      return cleanup;
    }

    setStorageMode("local");
    setSyncStatus("syncing");
    void (async () => {
      const result = await fetchCloudPortfolio();
      if (generation !== initGenerationRef.current) return;
      if (result.ok) {
        loadCloudChoice(result.data, local);
      } else {
        setSyncStatus("error");
        setSyncMessage(result.error);
      }
      setInitializedAccount(account);
    })();

    return cleanup;
  }, [account, authStatus, invalidatePriceRequests, loadCloudChoice, sessionUserId, setStorage]);

  const persist = useCallback(
    (next: PortfolioStorage) => {
      applyStorage(next);
    },
    [applyStorage]
  );

  const holdings = useMemo(
    () => enrichHoldings(storage?.holdings ?? []),
    [storage?.holdings]
  );

  const sales = useMemo(
    () => sortSalesByDateDesc(storage?.sales ?? []),
    [storage?.sales]
  );

  const summary = useMemo(
    () =>
      computePortfolioSummary(holdings, storage?.sales ?? [], {
        holdingsForTimeline: storage?.holdings ?? [],
        priceHistory: storage?.priceHistory ?? {},
      }),
    [holdings, storage?.sales, storage?.holdings, storage?.priceHistory]
  );

  const loans = storage?.loans ?? [];
  const grossInvestmentPnl = useMemo(
    () =>
      holdings
        .filter((holding) => holding.assetType !== "property")
        .reduce((sum, holding) => sum + holding.pnl, 0) +
      sales
        .filter((sale) => sale.assetType !== "property")
        .reduce((sum, sale) => sum + sale.realizedPnl, 0),
    [holdings, sales]
  );
  const loanSummary = useMemo(
    () =>
      calculatePortfolioLoanSummary(loans, {
        asOfDate: todayIsoDate(),
        grossInvestmentPnl,
      }),
    [grossInvestmentPnl, loans]
  );
  const loanRiskSummary = useMemo(
    () =>
      calculatePortfolioLoanRiskSummary(
        loans,
        storage?.holdings ?? [],
        todayIsoDate()
      ),
    [loans, storage?.holdings]
  );
  const loanReminders = useMemo(
    () =>
      buildLoanReminders(
        loans,
        storage?.holdings ?? [],
        todayIsoDate()
      ),
    [loans, storage?.holdings]
  );

  const exposure = useMemo(
    () =>
      computePortfolioExposure(
        holdings,
        { netAssets: storage?.settings.netAssets },
        loans
      ),
    [holdings, loans, storage?.settings.netAssets]
  );

  const pnlBreakdowns = useMemo(
    () => buildPortfolioPnlBreakdowns(holdings, storage?.priceHistory ?? {}),
    [holdings, storage?.priceHistory]
  );

  const pendingCorporateActions = useMemo(() => {
    const handled = new Set(
      (storage?.corporateActions ?? []).map(
        (action) => `${action.holdingId}:${action.sourceEventId}`
      )
    );
    return detectedCorporateActions.filter(
      (event) => !handled.has(`${event.holdingId}:${event.id}`)
    );
  }, [detectedCorporateActions, storage?.corporateActions]);

  const add = useCallback(
    (
      input: CreateHoldingInput,
      options?: { initialPrice?: number; initialPriceDate?: string }
    ): string | null => {
      const storage = storageRef.current;
      if (!storage) return null;
      let next = addHolding(storage, input);
      const created = next.holdings[next.holdings.length - 1];
      const initialPrice = options?.initialPrice;
      if (
        created &&
        initialPrice !== undefined &&
        Number.isFinite(initialPrice) &&
        initialPrice > 0
      ) {
        next = applyPriceUpdate(
          next,
          created.id,
          initialPrice,
          options?.initialPriceDate ??
            new Date().toISOString().slice(0, 10),
          "manual",
          { clearError: true }
        );
      }
      persist(next);
      setLatestAddedHoldingId(created?.id ?? null);
      return created?.id ?? null;
    },
    [persist]
  );

  const edit = useCallback(
    (input: EditHoldingInput) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(editHolding(storage, input));
    },
    [persist]
  );

  const sell = useCallback(
    (input: SellHoldingInput | SellHoldingInput[]) => {
      const storage = storageRef.current;
      if (!storage) return;
      const inputs = Array.isArray(input) ? input : [input];
      persist(sellHoldings(storage, inputs));
    },
    [persist]
  );

  const addDividend = useCallback(
    (input: CashDividendInput) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(addCashDividend(storage, input));
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(removeHolding(storage, id));
    },
    [persist]
  );

  const addLoan = useCallback(
    (input: CreateLoanInput): string | null => {
      const storage = storageRef.current;
      if (!storage) return null;
      const next = addLoanToStorage(storage, input);
      const created = next.loans[next.loans.length - 1];
      persist(next);
      return created?.id ?? null;
    },
    [persist]
  );

  const editLoan = useCallback(
    (input: EditLoanInput) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(editLoanInStorage(storage, input));
    },
    [persist]
  );

  const updateLoanBalance = useCallback(
    (id: string, balance: number, effectiveDate: string) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(
        recordLoanBalanceInStorage(storage, id, balance, effectiveDate)
      );
    },
    [persist]
  );

  const recordLoanPayment = useCallback(
    (id: string, input: CreateLoanPaymentInput) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(recordLoanPaymentInStorage(storage, id, input));
    },
    [persist]
  );

  const recordLoanRateChange = useCallback(
    (id: string, input: CreateLoanRateChangeInput) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(recordLoanRateChangeInStorage(storage, id, input));
    },
    [persist]
  );

  const setLoanStatus = useCallback(
    (id: string, status: LoanStatus, effectiveDate: string) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(setLoanStatusInStorage(storage, id, status, effectiveDate));
    },
    [persist]
  );

  const setManualPrice = useCallback(
    (id: string, price: number, priceDate: string) => {
      const current = storageRef.current;
      if (!current?.holdings.some((holding) => holding.id === id)) return;
      persist(applyPriceUpdate(current, id, price, priceDate, "manual", { clearError: true }));
    },
    [persist]
  );

  const updateOne = useCallback(
    async (id: string): Promise<boolean> => {
      // 新增後會立即查價，必須讀取最新存檔，即使 React 還沒重新渲染。
      const holding = storageRef.current?.holdings.find((h) => h.id === id);
      if (!holding || !supportsAutoPriceUpdate(holding.assetType)) return false;
      const generation = priceGenerationRef.current;
      let response;
      try {
        response = await fetchPriceUpdate(holdingToUpdateRequest(holding));
      } catch {
        response = {
          success: false as const,
          code: "PRICE_UNAVAILABLE",
          error: "無法連線更新價格，可稍後重試或手動輸入。",
        };
      }

      const current = storageRef.current;
      const target = current?.holdings.find((h) => h.id === id);
      if (
        !current || !target ||
        generation !== priceGenerationRef.current ||
        !isSamePriceTarget(target, holding) ||
        !hasUnchangedQuote(target, holding) ||
        (!isPriceError(response) && target.priceDate && response.priceDate < target.priceDate)
      ) return false;

      if (isPriceError(response)) {
        persist(updateHolding(current, id, { lastError: response.error }));
        return false;
      }

      persist(
        applyPriceUpdate(current, id, response.price, response.priceDate, "api", {
          name: response.name,
          market: response.market,
          clearError: true,
        })
      );
      return true;
    },
    [persist]
  );

  const refreshPrices = useCallback(async (range?: PriceHistoryRange) => {
    const initial = storageRef.current;
    if (!initial?.holdings.length) return { ok: false, error: "尚無持倉" };
    if (priceBatchRef.current) return { ok: false, error: "已有一項價格更新正在進行" };

    const refreshQuotes = typeof range !== "object";
    const autoPriced = initial.holdings.filter((holding) => supportsAutoPriceUpdate(holding.assetType));
    const historyTargets = initial.holdings.filter((holding) =>
      typeof range !== "object" || holding.buyDate <= range.endDate
    );
    const importable = historyTargets.filter(canImportHistory);
    if ((!refreshQuotes || autoPriced.length === 0) && (!range || importable.length === 0)) {
      const message = range
        ? "現有持倉沒有可自動補齊的歷史價格"
        : "無可自動更新的持倉，房產可在持倉頁手動估價";
      setBatchStatus("done");
      setBatchMessage(range ? null : message);
      return { ok: false, error: message };
    }

    const request = Symbol();
    priceBatchRef.current = request;
    const isCurrentRequest = () => priceBatchRef.current === request;
    const replaced = { ok: false, error: "資料來源已變更，請重新更新" };
    setBatchStatus("loading");
    setBatchMessage(null);

    let priceOk = 0;
    let priceFail = 0;
    let historyOk = 0;
    let historyFail = 0;
    let skipped = 0;
    let quoteError: string | undefined;
    let historyError: string | undefined;

    try {
      if (refreshQuotes && autoPriced.length > 0) {
        try {
          const batch = await fetchBatchPriceUpdate(autoPriced);
          if (!isCurrentRequest() || !storageRef.current) return replaced;
          const result = applyQuoteResults(storageRef.current, autoPriced, batch.results);
          priceOk = result.updated;
          priceFail = result.failed;
          skipped += result.skipped;
          persist(updateSettings(result.next, { lastBatchUpdateAt: batch.updatedAt }));
        } catch {
          priceFail = autoPriced.length;
          quoteError = "無法連線更新現價";
        }
      }

      if (!isCurrentRequest()) return replaced;
      if (range && importable.length > 0) {
        // 現價與歷史查詢都可能使用 TWSE，間隔查詢可降低限流。
        if (refreshQuotes && autoPriced.length > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!isCurrentRequest()) return replaced;
        const results = await fetchHistoryForHoldings(importable, range);
        if (!isCurrentRequest() || !storageRef.current) return replaced;
        const result = applyHistoryResults(storageRef.current, importable, results);
        historyOk = result.updated;
        historyFail = result.failed;
        skipped += result.skipped;
        historyError = result.error;
        if (result.next !== storageRef.current) persist(result.next);
      }

      const parts: string[] = [];
      if (priceOk > 0) parts.push(`現價已更新 ${priceOk} 筆`);
      if (priceFail > 0) parts.push(quoteError ?? `現價失敗 ${priceFail} 筆`);
      if (historyOk > 0) parts.push(`歷史已載入 ${historyOk} 筆持倉`);
      if (historyFail > 0) parts.push(`歷史失敗 ${historyFail} 筆`);
      if (range && historyTargets.length > importable.length) parts.push("部分持倉使用既有價格歷史");
      if (skipped > 0) parts.push(`略過 ${skipped} 筆已變更或已有較新價格的持倉`);
      const ok = priceOk > 0 || historyOk > 0;
      const message = parts.join("。") || "無可更新項目";
      const detail = !ok && historyError ? `${message}。${historyError}` : message;
      setBatchStatus(ok ? (priceFail || historyFail || skipped ? "partial" : "done") : "error");
      if (!range) setBatchMessage(detail);
      return ok ? { ok: true, message: detail } : { ok: false, error: detail };
    } catch {
      if (!isCurrentRequest()) return replaced;
      const error = "無法完成價格更新，已保存先前成功的變更。請稍後重試。";
      setBatchStatus("error");
      if (!range) setBatchMessage(error);
      return { ok: false, error };
    } finally {
      if (isCurrentRequest()) priceBatchRef.current = null;
    }
  }, [persist]);

  const updateAll = useCallback(async () => {
    await refreshPrices();
  }, [refreshPrices]);

  const scanCorporateActions = useCallback(async () => {
    if (!storage) return;
    const stockHoldings = storage.holdings.filter((h) => h.assetType === "stock");
    if (stockHoldings.length === 0) {
      setDetectedCorporateActions([]);
      setCorporateActionStatus("done");
      setCorporateActionMessage("沒有台股持倉可查詢");
      return;
    }

    setCorporateActionStatus("loading");
    setCorporateActionMessage(null);

    try {
      const res = await fetchCorporateActions(stockHoldings);
      if (!res.success) {
        setCorporateActionStatus("error");
        setCorporateActionMessage(res.error);
        return;
      }
      setDetectedCorporateActions(res.events);
      const handled = new Set(
        storage.corporateActions.map(
          (action) => `${action.holdingId}:${action.sourceEventId}`
        )
      );
      const pendingCount = res.events.filter(
        (event) => !handled.has(`${event.holdingId}:${event.id}`)
      ).length;
      setCorporateActionStatus("done");
      setCorporateActionMessage(
        pendingCount > 0
          ? `找到 ${pendingCount} 筆待處理公司行動`
          : "目前沒有待處理公司行動"
      );
    } catch {
      setCorporateActionStatus("error");
      setCorporateActionMessage("公司行動查詢失敗，請稍後重試");
    }
  }, [storage]);

  const applyDetectedCorporateAction = useCallback(
    (event: CorporateActionEvent) => {
      const current = storageRef.current;
      if (current) persist(applyCorporateAction(current, event));
      setCorporateActionMessage("已處理公司行動");
    },
    [persist]
  );

  const applyManualAction = useCallback(
    (input: ManualCorporateActionInput) => {
      const current = storageRef.current;
      if (current) persist(applyManualCorporateAction(current, input));
      setCorporateActionMessage("已套用手動公司行動調整");
    },
    [persist]
  );

  const applyManualActionToGroup = useCallback(
    (groupKey: string, input: Omit<ManualCorporateActionInput, "holdingId">) => {
      const current = storageRef.current;
      if (current) persist(applyManualCorporateActionToGroup(current, groupKey, input));
      setCorporateActionMessage("已套用手動公司行動調整");
    },
    [persist]
  );

  const setAutoUpdate = useCallback(
    (enabled: boolean) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(updateSettings(storage, { autoUpdateEnabled: enabled }));
    },
    [persist]
  );

  const setExposureSettings = useCallback(
    (patch: Pick<PortfolioSettings, "netAssets">) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(updateSettings(storage, patch));
    },
    [persist]
  );

  const setAllocationTargets = useCallback(
    (allocationTargets: AssetAllocationTargets) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(updateSettings(storage, { allocationTargets }));
    },
    [persist]
  );

  const setThemePreference = useCallback(
    (theme: UiTheme) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(updateSettings(storage, { theme }));
    },
    [persist]
  );

  const applyUiPreferences = useCallback(
    (theme: UiTheme, preferences: UiPreferences) => {
      const storage = storageRef.current;
      if (!storage) return;
      persist(
        updateSettings(storage, {
          theme,
          uiPreferences: {
            ...preferences,
            updatedAt: preferences.updatedAt ?? new Date().toISOString(),
          },
        })
      );
    },
    [persist]
  );

  const importPriceHistory = useCallback(async (groupKey: string, range: ChartRange) => {
    const initial = storageRef.current;
    if (!initial) return { ok: false, error: "尚未載入資料" };
    const requested = initial.holdings.filter(
      (holding) => holdingGroupKey(holding) === groupKey && canImportHistory(holding)
    );
    if (!requested.length) return { ok: false, error: "此標的無法自動載入歷史價格" };

    const generation = priceGenerationRef.current;
    const results = await fetchHistoryForHoldings(requested, range);
    const current = storageRef.current;
    if (!current || generation !== priceGenerationRef.current) {
      return { ok: false, error: "資料來源已變更，請重新載入" };
    }

    const result = applyHistoryResults(current, requested, results);
    if (result.next !== current) persist(result.next);
    if (!result.updated) return { ok: false, error: result.error ?? "持倉已變更，請重新選擇標的" };
    return {
      ok: true,
      count: result.dates.length,
      startDate: result.dates[0],
      endDate: result.dates.at(-1),
    };
  }, [persist]);

  const refreshPortfolioForRange = refreshPrices;

  const importFundHistory = importPriceHistory;

  const importPortfolio = useCallback(
    (incoming: PortfolioStorage, mode: PortfolioImportMode) => {
      const current = storageRef.current;
      if (!current) return;
      if (mode === "replace") invalidatePriceRequests();
      persist(applyImportMode(current, incoming, mode));
    },
    [invalidatePriceRequests, persist]
  );

  const refreshFromCloud = useCallback(async (): Promise<boolean> => {
    if (!sessionUserId || initializedAccount !== account ||
        cloudQueueRef.current?.inFlight || cloudReadRef.current) return false;

    const generation = initGenerationRef.current;
    const request = Symbol();
    cloudReadRef.current = request;
    cloudQueueRef.current = null;
    setStorageMode("local");
    setSyncStatus("syncing");
    setSyncMessage("正在讀取雲端版本…");
    const result = await fetchCloudPortfolio();
    if (cloudReadRef.current === request) cloudReadRef.current = null;
    const local = storageRef.current;
    if (!local || generation !== initGenerationRef.current) return false;
    if (!result.ok) {
      setSyncStatus("error");
      setSyncMessage(result.error);
      return false;
    }

    loadCloudChoice(result.data, local);
    if (cloudQueueRef.current) clearUploadPromptDismissed(sessionUserId);
    return true;
  }, [account, initializedAccount, loadCloudChoice, sessionUserId]);

  const keepLocalOnly = useCallback(() => {
    if (sessionUserId) setUploadPromptDismissed(sessionUserId);
    cloudQueueRef.current = null;
    setCloudChoice(null);
    setStorageMode("local");
    setSyncStatus("idle");
    setSyncMessage("目前只存本機");
  }, [sessionUserId]);

  const useLocalForSync = useCallback(() => {
    if (!cloudChoice || !sessionUserId || !storageRef.current) return;
    clearUploadPromptDismissed(sessionUserId);
    connectCloud(cloudChoice.version);
    void pushCloudSync(storageRef.current);
  }, [cloudChoice, connectCloud, pushCloudSync, sessionUserId]);

  const useRemoteForSync = useCallback(() => {
    if (!cloudChoice?.remote || !sessionUserId || !storageRef.current) return;
    const repaired = repairCorporateActionPriceHistory(cloudChoice.remote);
    const next = preserveNewerUiPreferences(repaired, storageRef.current);
    invalidatePriceRequests();
    applyStorage(next, { skipCloud: true });
    clearUploadPromptDismissed(sessionUserId);
    connectCloud(cloudChoice.version);
    if (next !== cloudChoice.remote) void pushCloudSync(next);
  }, [applyStorage, cloudChoice, connectCloud, invalidatePriceRequests, pushCloudSync, sessionUserId]);

  const value = useMemo(
    () => ({
      ready: storage !== null && authStatus !== "loading" && initializedAccount === account,
      storageMode,
      syncStatus,
      syncMessage,
      holdings,
      loans,
      loanSummary,
      loanRiskSummary,
      loanReminders,
      sales,
      summary,
      exposure,
      pnlBreakdowns,
      // 首次 SSR 與瀏覽器 hydration 必須產生相同內容；本機資料會在上方
      // 初始化 effect 掛載後載入。若在 render 直接讀 localStorage，React 會
      // 保留伺服器的舊 data-ui-* 屬性，導致重整後看似沒有套用新版面。
      storage: storage ?? defaultPortfolioStorage(),
      batchStatus,
      batchMessage,
      corporateActionStatus,
      corporateActionMessage,
      pendingCorporateActions,
      latestAddedHoldingId,
      dismissAddedHolding,
      add,
      edit,
      sell,
      addDividend,
      remove,
      addLoan,
      editLoan,
      updateLoanBalance,
      recordLoanPayment,
      recordLoanRateChange,
      setLoanStatus,
      setManualPrice,
      updateOne,
      updateAll,
      scanCorporateActions,
      applyDetectedCorporateAction,
      applyManualAction,
      applyManualActionToGroup,
      refreshPortfolioForRange,
      importPriceHistory,
      importFundHistory,
      setAutoUpdate,
      setExposureSettings,
      setAllocationTargets,
      setThemePreference,
      applyUiPreferences,
      importPortfolio,
      refreshFromCloud,
    }),
    [
      storage,
      authStatus,
      initializedAccount,
      account,
      storageMode,
      syncStatus,
      syncMessage,
      holdings,
      loans,
      loanSummary,
      loanRiskSummary,
      loanReminders,
      sales,
      summary,
      exposure,
      pnlBreakdowns,
      batchStatus,
      batchMessage,
      corporateActionStatus,
      corporateActionMessage,
      pendingCorporateActions,
      latestAddedHoldingId,
      dismissAddedHolding,
      add,
      edit,
      sell,
      addDividend,
      remove,
      addLoan,
      editLoan,
      updateLoanBalance,
      recordLoanPayment,
      recordLoanRateChange,
      setLoanStatus,
      setManualPrice,
      updateOne,
      updateAll,
      scanCorporateActions,
      applyDetectedCorporateAction,
      applyManualAction,
      applyManualActionToGroup,
      refreshPortfolioForRange,
      importPriceHistory,
      importFundHistory,
      setAutoUpdate,
      setExposureSettings,
      setAllocationTargets,
      setThemePreference,
      applyUiPreferences,
      importPortfolio,
      refreshFromCloud,
    ]
  );

  return (
    <PortfolioContext.Provider value={value}>
      {cloudChoice?.remote && storage ? (
        <CloudMergeModal
          local={storage}
          cloud={cloudChoice.remote}
          onChooseLocal={useLocalForSync}
          onChooseCloud={useRemoteForSync}
          onDismiss={keepLocalOnly}
        />
      ) : cloudChoice && storage ? (
        <CloudUploadPromptModal
          local={storage}
          onUpload={useLocalForSync}
          onKeepLocalOnly={keepLocalOnly}
        />
      ) : null}
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio 必須在 PortfolioProvider 內使用");
  return ctx;
}
