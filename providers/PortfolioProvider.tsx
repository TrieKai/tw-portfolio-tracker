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
import { PORTFOLIO_STORAGE_KEY } from "@/lib/portfolio/constants";
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
  commitPortfolio,
  editHolding,
  loadPortfolio,
  removeHolding,
  repairCorporateActionPriceHistory,
  sellHoldings,
  UnreadablePortfolioError,
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
  restartLoan,
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
  ) => Promise<string | null>;
  edit: (input: EditHoldingInput, original: Holding) => Promise<boolean>;
  sell: (input: SellHoldingInput | SellHoldingInput[]) => Promise<boolean>;
  addDividend: (input: CashDividendInput) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  addLoan: (input: CreateLoanInput, restartFromId?: string) => Promise<string | null>;
  editLoan: (input: EditLoanInput) => Promise<boolean>;
  updateLoanBalance: (
    id: string,
    balance: number,
    effectiveDate: string
  ) => Promise<boolean>;
  recordLoanPayment: (id: string, input: CreateLoanPaymentInput) => Promise<boolean>;
  recordLoanRateChange: (id: string, input: CreateLoanRateChangeInput) => Promise<boolean>;
  setLoanStatus: (
    id: string,
    status: LoanStatus,
    effectiveDate: string
  ) => Promise<boolean>;
  setManualPrice: (id: string, price: number, priceDate: string) => Promise<boolean>;
  updateOne: (id: string) => Promise<boolean>;
  updateAll: () => Promise<void>;
  scanCorporateActions: () => Promise<void>;
  applyDetectedCorporateAction: (event: CorporateActionEvent) => Promise<boolean>;
  applyManualAction: (input: ManualCorporateActionInput) => Promise<boolean>;
  applyManualActionToGroup: (
    groupKey: string,
    input: Omit<ManualCorporateActionInput, "holdingId">
  ) => Promise<boolean>;
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
  setAutoUpdate: (enabled: boolean) => Promise<boolean>;
  setExposureSettings: (
    patch: Pick<PortfolioSettings, "netAssets">
  ) => Promise<boolean>;
  setAllocationTargets: (targets: AssetAllocationTargets) => Promise<boolean>;
  setThemePreference: (theme: UiTheme) => Promise<boolean>;
  applyUiPreferences: (theme: UiTheme, preferences: UiPreferences) => Promise<boolean>;
  /** 從 JSON 備份匯入（取代或合併） */
  importPortfolio: (
    incoming: PortfolioStorage,
    mode: PortfolioImportMode
  ) => Promise<boolean>;
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
const EMPTY_LOANS: Loan[] = [];

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: authStatus } = useSession();

  const [storage, setStorageState] = useState<PortfolioStorage | null>(null);
  const storageRef = useRef<PortfolioStorage | null>(null);
  const setStorage = useCallback((next: PortfolioStorage) => {
    storageRef.current = next;
    setStorageState(next);
  }, []);
  const [storageMode, setStorageMode] = useState<StorageMode>("anonymous");
  const [storageError, setStorageError] = useState<string | null>(null);
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
        if (sessionUserId && isUploadPromptDismissed(sessionUserId)) return;
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
  }, [sessionUserId]);

  const applyStorage = useCallback(
    async (
      update: (latest: PortfolioStorage) => PortfolioStorage | null,
      options?: {
        skipCloud?: boolean;
        onSaved?: (saved: PortfolioStorage) => void;
        overwriteUnreadable?: boolean;
      }
    ) => {
      const generation = initGenerationRef.current;
      try {
        return await commitPortfolio(
          (latest) => generation === initGenerationRef.current ? update(latest) : null,
          (saved) => {
            setStorage(saved);
            setStorageError(null);
            options?.onSaved?.(saved);
            if (!options?.skipCloud) void pushCloudSync(saved);
          },
          options?.overwriteUnreadable
        );
      } catch (error) {
        if (generation === initGenerationRef.current) {
          setStorageError(error instanceof UnreadablePortfolioError
            ? "無法讀取本機資料。可到持倉頁的資料備份，用 JSON 備份取代資料。"
            : "這次變更未儲存。請確認瀏覽器允許儲存，並釋出空間後重試。");
        }
        return false;
      }
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

  const loadCloudChoice = useCallback(async (remote: CloudPortfolioEnvelope | null) => {
    const version = remote?.updatedAt ?? null;
    let needsChoice = false;
    const saved = await applyStorage((local) => {
      if (!remote || !hasPortfolioData(remote.portfolio)) {
        if (!hasPortfolioData(local)) return local;
        needsChoice = true;
        setStorageMode("local");
        setCloudChoice({ version, remote: null });
        setSyncStatus("idle");
        setSyncMessage("本機已有資料，請確認是否開始同步。");
        return null;
      }

      const sameData = comparablePortfolio(local) === comparablePortfolio(remote.portfolio);
      if (hasPortfolioData(local) && !sameData) {
        needsChoice = true;
        setStorageMode("local");
        setCloudChoice({ version, remote: remote.portfolio });
        setSyncStatus("idle");
        setSyncMessage("本機與雲端資料不同，請選擇要使用的版本。");
        return null;
      }

      if (!sameData) invalidatePriceRequests();
      return preserveNewerUiPreferences(repairCorporateActionPriceHistory(remote.portfolio), local);
    }, {
      skipCloud: true,
      onSaved: (saved) => {
        connectCloud(version);
        if (sessionUserId) clearUploadPromptDismissed(sessionUserId);
        if (remote && hasPortfolioData(remote.portfolio) && saved !== remote.portfolio) {
          void pushCloudSync(saved);
        }
      },
    });
    return saved || needsChoice;
  }, [applyStorage, connectCloud, invalidatePriceRequests, pushCloudSync, sessionUserId]);

  const readLocalPortfolio = useCallback(() => {
    try {
      setStorage(loadPortfolio());
      setStorageError(null);
    } catch {
      if (!storageRef.current) setStorage(defaultPortfolioStorage());
      setStorageError("無法讀取本機資料。請確認瀏覽器允許存取，或從備份復原。");
    }
  }, [setStorage]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === PORTFOLIO_STORAGE_KEY || event.key === null) readLocalPortfolio();
      if (sessionUserId && isUploadPromptDismissed(sessionUserId)) {
        cloudQueueRef.current = null;
        setCloudChoice(null);
        setStorageMode("local");
        setSyncStatus("idle");
        setSyncMessage("目前只存本機");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [readLocalPortfolio, sessionUserId]);

  useEffect(() => {
    if (authStatus === "loading") return;
    const generation = ++initGenerationRef.current;
    cloudQueueRef.current = null;
    cloudReadRef.current = null;
    invalidatePriceRequests();
    setCloudChoice(null);
    setLatestAddedHoldingId(null);
    readLocalPortfolio();
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
      if (isUploadPromptDismissed(sessionUserId)) {
        setInitializedAccount(account);
        return;
      }
      if (result.ok) {
        if (!(await loadCloudChoice(result.data)) && generation === initGenerationRef.current) {
          setSyncStatus("error");
          setSyncMessage("請先確認本機資料可讀寫，再啟用雲端同步。");
        }
      } else {
        setSyncStatus("error");
        setSyncMessage(result.error);
      }
      if (generation === initGenerationRef.current) setInitializedAccount(account);
    })();

    return cleanup;
  }, [account, authStatus, invalidatePriceRequests, loadCloudChoice, readLocalPortfolio, sessionUserId]);

  const persist = useCallback(
    (update: (latest: PortfolioStorage) => PortfolioStorage | null) =>
      applyStorage((latest) => {
        const next = update(latest);
        return next !== latest ? next : null;
      }),
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

  const loans = storage?.loans ?? EMPTY_LOANS;
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
    async (
      input: CreateHoldingInput,
      options?: { initialPrice?: number; initialPriceDate?: string }
    ): Promise<string | null> => {
      let createdId: string | null = null;
      const saved = await persist((latest) => {
        const next = addHolding(latest, input);
        if (next === latest) return null;
        const created = next.holdings.at(-1)!;
        createdId = created.id;
        const initialPrice = options?.initialPrice;
        if (initialPrice === undefined || !Number.isFinite(initialPrice) || initialPrice <= 0) {
          return next;
        }
        return applyPriceUpdate(
          next,
          created.id,
          initialPrice,
          options?.initialPriceDate ?? todayIsoDate(),
          "manual",
          { clearError: true }
        );
      });
      if (!saved) return null;
      setLatestAddedHoldingId(createdId);
      return createdId;
    },
    [persist]
  );

  const edit = useCallback(
    (input: EditHoldingInput, original: Holding) => persist((latest) => {
      const current = latest.holdings.find((holding) => holding.id === input.id);
      if (!current || !isSamePriceTarget(current, original) || current.quantity !== original.quantity ||
        current.buyPrice !== original.buyPrice || current.buyDate !== original.buyDate) {
        return null;
      }
      return editHolding(latest, input);
    }),
    [persist]
  );

  const sell = useCallback(
    (input: SellHoldingInput | SellHoldingInput[]) =>
      persist((latest) => sellHoldings(latest, Array.isArray(input) ? input : [input])),
    [persist]
  );

  const addDividend = useCallback(
    (input: CashDividendInput) => persist((latest) => addCashDividend(latest, input)),
    [persist]
  );

  const remove = useCallback(
    (id: string) => persist((latest) => removeHolding(latest, id)),
    [persist]
  );

  const addLoan = useCallback(
    async (input: CreateLoanInput, restartFromId?: string): Promise<string | null> => {
      let createdId: string | null = null;
      const saved = await persist((latest) => {
        const next = restartFromId
          ? restartLoan(latest, restartFromId, input)
          : addLoanToStorage(latest, input);
        if (next === latest) return null;
        createdId = next.loans.at(-1)!.id;
        return next;
      });
      return saved ? createdId : null;
    },
    [persist]
  );

  const editLoan = useCallback(
    (input: EditLoanInput) => persist((latest) => editLoanInStorage(latest, input)),
    [persist]
  );

  const updateLoanBalance = useCallback(
    (id: string, balance: number, effectiveDate: string) =>
      persist((latest) => recordLoanBalanceInStorage(latest, id, balance, effectiveDate)),
    [persist]
  );

  const recordLoanPayment = useCallback(
    (id: string, input: CreateLoanPaymentInput) =>
      persist((latest) => recordLoanPaymentInStorage(latest, id, input)),
    [persist]
  );

  const recordLoanRateChange = useCallback(
    (id: string, input: CreateLoanRateChangeInput) =>
      persist((latest) => recordLoanRateChangeInStorage(latest, id, input)),
    [persist]
  );

  const setLoanStatus = useCallback(
    (id: string, status: LoanStatus, effectiveDate: string) =>
      persist((latest) => setLoanStatusInStorage(latest, id, status, effectiveDate)),
    [persist]
  );

  const setManualPrice = useCallback(
    (id: string, price: number, priceDate: string) =>
      persist((latest) => latest.holdings.some((holding) => holding.id === id)
        ? applyPriceUpdate(latest, id, price, priceDate, "manual", { clearError: true })
        : null),
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

      const saved = await persist((latest) => {
        const target = latest.holdings.find((h) => h.id === id);
        if (
          !target ||
          generation !== priceGenerationRef.current ||
          !isSamePriceTarget(target, holding) ||
          !hasUnchangedQuote(target, holding) ||
          (!isPriceError(response) && target.priceDate && response.priceDate < target.priceDate)
        ) return null;
        if (isPriceError(response)) return updateHolding(latest, id, { lastError: response.error });
        return applyPriceUpdate(latest, id, response.price, response.priceDate, "api", {
          name: response.name,
          market: response.market,
          clearError: true,
        });
      });
      return saved && !isPriceError(response);
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
          const saved = await persist((latest) => {
            if (!isCurrentRequest()) return null;
            const result = applyQuoteResults(latest, autoPriced, batch.results);
            priceOk = result.updated;
            priceFail = result.failed;
            skipped += result.skipped;
            return updateSettings(result.next, { lastBatchUpdateAt: batch.updatedAt });
          });
          if (!saved) {
            priceOk = 0;
            priceFail = autoPriced.length;
            quoteError = "現價更新未儲存";
          }
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
        const saved = await persist((latest) => {
          if (!isCurrentRequest()) return null;
          const result = applyHistoryResults(latest, importable, results);
          historyOk = result.updated;
          historyFail = result.failed;
          skipped += result.skipped;
          historyError = result.error;
          return result.next;
        });
        if (!saved && historyOk > 0) {
          historyOk = 0;
          historyFail = importable.length;
          historyError = "歷史價格未儲存";
        }
      }

      if (!isCurrentRequest()) return replaced;
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
    async (event: CorporateActionEvent) => {
      const saved = await persist((latest) => applyCorporateAction(latest, event));
      if (saved) setCorporateActionMessage("已處理公司行動");
      return saved;
    },
    [persist]
  );

  const applyManualAction = useCallback(
    async (input: ManualCorporateActionInput) => {
      const saved = await persist((latest) => applyManualCorporateAction(latest, input));
      if (saved) setCorporateActionMessage("已套用手動公司行動調整");
      return saved;
    },
    [persist]
  );

  const applyManualActionToGroup = useCallback(
    async (groupKey: string, input: Omit<ManualCorporateActionInput, "holdingId">) => {
      const saved = await persist((latest) => applyManualCorporateActionToGroup(latest, groupKey, input));
      if (saved) setCorporateActionMessage("已套用手動公司行動調整");
      return saved;
    },
    [persist]
  );

  const setAutoUpdate = useCallback(
    (enabled: boolean) => persist((latest) => updateSettings(latest, { autoUpdateEnabled: enabled })),
    [persist]
  );

  const setExposureSettings = useCallback(
    (patch: Pick<PortfolioSettings, "netAssets">) => persist((latest) => updateSettings(latest, patch)),
    [persist]
  );

  const setAllocationTargets = useCallback(
    (allocationTargets: AssetAllocationTargets) =>
      persist((latest) => updateSettings(latest, { allocationTargets })),
    [persist]
  );

  const setThemePreference = useCallback(
    (theme: UiTheme) => persist((latest) => updateSettings(latest, { theme })),
    [persist]
  );

  const applyUiPreferences = useCallback(
    (theme: UiTheme, preferences: UiPreferences) =>
      persist((latest) => {
        const updatedAt = preferences.updatedAt ?? new Date().toISOString();
        if (updatedAt < (latest.settings.uiPreferences?.updatedAt ?? "")) return null;
        return updateSettings(latest, { theme, uiPreferences: { ...preferences, updatedAt } });
      }),
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
    let dates: string[] = [];
    let error: string | undefined;
    const saved = await persist((latest) => {
      if (generation !== priceGenerationRef.current) return null;
      const result = applyHistoryResults(latest, requested, results);
      dates = result.dates;
      error = result.error;
      return result.next;
    });
    if (generation !== priceGenerationRef.current) {
      return { ok: false, error: "資料來源已變更，請重新載入" };
    }

    if (!saved || !dates.length) {
      return { ok: false, error: error ?? (dates.length ? "歷史價格未儲存" : "持倉已變更，請重新選擇標的") };
    }
    return {
      ok: true,
      count: dates.length,
      startDate: dates[0],
      endDate: dates.at(-1),
    };
  }, [persist]);

  const refreshPortfolioForRange = refreshPrices;

  const importFundHistory = importPriceHistory;

  const importPortfolio = useCallback(
    (incoming: PortfolioStorage, mode: PortfolioImportMode) => {
      return applyStorage(
        (latest) => applyImportMode(latest, incoming, mode),
        {
          overwriteUnreadable: mode === "replace",
          onSaved: mode === "replace" ? invalidatePriceRequests : undefined,
        }
      );
    },
    [applyStorage, invalidatePriceRequests]
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
    if (generation !== initGenerationRef.current) return false;
    if (!result.ok) {
      setSyncStatus("error");
      setSyncMessage(result.error);
      return false;
    }

    const loaded = await loadCloudChoice(result.data);
    if (!loaded && generation === initGenerationRef.current) {
      setSyncStatus("error");
      setSyncMessage("請先確認本機資料可讀寫，再啟用雲端同步。");
    }
    return loaded;
  }, [account, initializedAccount, loadCloudChoice, sessionUserId]);

  const keepLocalOnly = useCallback(() => {
    if (sessionUserId) setUploadPromptDismissed(sessionUserId);
    cloudQueueRef.current = null;
    setCloudChoice(null);
    setStorageMode("local");
    setSyncStatus("idle");
    setSyncMessage("目前只存本機");
  }, [sessionUserId]);

  const useLocalForSync = useCallback(async () => {
    if (!cloudChoice || !sessionUserId || !storageRef.current) return;
    await applyStorage((local) => local, {
      onSaved: () => {
        clearUploadPromptDismissed(sessionUserId);
        connectCloud(cloudChoice.version);
      },
    });
  }, [applyStorage, cloudChoice, connectCloud, sessionUserId]);

  const useRemoteForSync = useCallback(async () => {
    if (!cloudChoice?.remote || !sessionUserId || !storageRef.current) return;
    const remote = cloudChoice.remote;
    await applyStorage((local) => {
      invalidatePriceRequests();
      return preserveNewerUiPreferences(repairCorporateActionPriceHistory(remote), local);
    }, {
      skipCloud: true,
      onSaved: (saved) => {
        clearUploadPromptDismissed(sessionUserId);
        connectCloud(cloudChoice.version);
        if (saved !== remote) void pushCloudSync(saved);
      },
    });
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
      {storageError && (
        <div role="alert" className="mx-auto my-3 flex max-w-7xl flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 px-4 py-3 text-sm">
          <span>{storageError}</span>
          <button type="button" className="underline underline-offset-4" onClick={() => setStorageError(null)}>關閉提示</button>
        </div>
      )}
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
