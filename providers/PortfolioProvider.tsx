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
import { CloudUploadPromptModal } from "@/components/auth/CloudUploadPromptModal";
import {
  isUploadPromptDismissed,
  setUploadPromptDismissed,
} from "@/lib/client/upload-prompt-storage";
import {
  canImportHistory,
  fetchHistoryForHoldings,
  fetchHoldingHistoryPoints,
} from "@/lib/client/holding-history";
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
import { getChartRangeLabel } from "@/lib/portfolio/chart-date-range";
import {
  enrichHoldings,
  computePortfolioSummary,
  sortSalesByDateDesc,
} from "@/lib/portfolio/calculations";
import { applyImportMode } from "@/lib/storage/portfolio-export";
import type { PortfolioImportMode } from "@/lib/storage/portfolio-export";
import { hasPortfolioData } from "@/lib/storage/parse-portfolio";
import {
  addHolding,
  applyImportedPriceHistory,
  applyPriceUpdate,
  editHolding,
  loadPortfolio,
  removeHolding,
  sellHolding,
  savePortfolio,
  updateHolding,
  updateSettings,
} from "@/lib/storage/portfolio-store";
import type {
  CreateHoldingInput,
  EditHoldingInput,
  Holding,
  HoldingWithMetrics,
  PortfolioStorage,
  PortfolioSummary,
  SaleTransaction,
  SellHoldingInput,
} from "@/lib/types/holding";

type UpdateStatus = "idle" | "loading" | "partial" | "done" | "error";
export type StorageMode = "anonymous" | "cloud";
export type SyncStatus = "idle" | "syncing" | "synced" | "error";

interface PortfolioContextValue {
  ready: boolean;
  storageMode: StorageMode;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  holdings: HoldingWithMetrics[];
  sales: SaleTransaction[];
  summary: PortfolioSummary;
  storage: PortfolioStorage;
  batchStatus: UpdateStatus;
  batchMessage: string | null;
  add: (input: CreateHoldingInput) => string | null;
  edit: (input: EditHoldingInput) => void;
  sell: (input: SellHoldingInput) => void;
  remove: (id: string) => void;
  setManualPrice: (id: string, price: number, priceDate: string) => void;
  updateOne: (id: string) => Promise<boolean>;
  updateAll: () => Promise<void>;
  refreshPortfolioForRange: (range: ChartRange) => Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
  importPriceHistory: (
    holdingId: string,
    range: ChartRange
  ) => Promise<{ ok: boolean; count?: number; error?: string }>;
  importFundHistory: (
    holdingId: string,
    range: ChartRange
  ) => Promise<{ ok: boolean; count?: number; error?: string }>;
  setAutoUpdate: (enabled: boolean) => void;
  /** 從 JSON 備份匯入（取代或合併） */
  importPortfolio: (
    incoming: PortfolioStorage,
    mode: PortfolioImportMode
  ) => void;
  /** 強制從雲端重新載入（新裝置／同步異常時使用） */
  refreshFromCloud: () => Promise<boolean>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status: authStatus } = useSession();
  const isAuthenticated =
    authStatus === "authenticated" && !!session?.user?.id;

  const [storage, setStorage] = useState<PortfolioStorage | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>("anonymous");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<UpdateStatus>("idle");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [uploadPrompt, setUploadPrompt] = useState<PortfolioStorage | null>(
    null
  );

  const sessionUserId = session?.user?.id;
  const cloudUpdatedAtRef = useRef<string | undefined>(undefined);
  const cloudSyncInFlightRef = useRef(false);
  const cloudSyncPendingRef = useRef<PortfolioStorage | null>(null);
  const initGenerationRef = useRef(0);

  const flushCloudSync = useCallback(async (next: PortfolioStorage) => {
    setSyncStatus("syncing");
    setSyncMessage(null);
    const res = await pushCloudPortfolio(next, cloudUpdatedAtRef.current);
    if (res.ok) {
      cloudUpdatedAtRef.current = res.updatedAt;
      setSyncStatus("synced");
      return;
    }
    if (res.status === 409 && res.remote) {
      cloudUpdatedAtRef.current = res.remote.updatedAt;
      setStorage(res.remote.portfolio);
      savePortfolio(res.remote.portfolio);
      setSyncStatus("synced");
      setSyncMessage("已套用雲端較新版本");
      return;
    }
    setSyncStatus("error");
    setSyncMessage(res.error);
  }, []);

  /** 登入後每次變更立即寫入雲端；若前一次尚在進行中則排隊最新一份 */
  const pushCloudSync = useCallback(
    async (next: PortfolioStorage) => {
      if (cloudSyncInFlightRef.current) {
        cloudSyncPendingRef.current = next;
        return;
      }
      cloudSyncInFlightRef.current = true;
      try {
        await flushCloudSync(next);
      } finally {
        cloudSyncInFlightRef.current = false;
        const pending = cloudSyncPendingRef.current;
        cloudSyncPendingRef.current = null;
        if (pending) void pushCloudSync(pending);
      }
    },
    [flushCloudSync]
  );

  const applyStorage = useCallback(
    (next: PortfolioStorage, options?: { skipCloud?: boolean }) => {
      setStorage(next);
      savePortfolio(next);
      if (isAuthenticated && !options?.skipCloud) {
        void pushCloudSync(next);
      }
    },
    [isAuthenticated, pushCloudSync]
  );

  const uploadToCloud = useCallback(async (next: PortfolioStorage) => {
    setSyncStatus("syncing");
    const res = await pushCloudPortfolio(next);
    if (res.ok) {
      cloudUpdatedAtRef.current = res.updatedAt;
      setSyncStatus("synced");
      setSyncMessage(null);
      return true;
    }
    setSyncStatus("error");
    setSyncMessage(res.error);
    return false;
  }, []);

  const initCloudStorage = useCallback(async () => {
    const generation = ++initGenerationRef.current;
    setSyncStatus("syncing");
    setSyncMessage("正在載入雲端資料…");

    const local = loadPortfolio();
    const res = await fetchCloudPortfolio();

    if (generation !== initGenerationRef.current) return;

    if (!res.ok) {
      setStorageMode("cloud");
      setStorage(local);
      setSyncStatus("error");
      setSyncMessage(
        res.code === "KV_NOT_CONFIGURED"
          ? `${res.error}（此環境無法跨裝置同步，可用 JSON 匯出／匯入）`
          : res.error
      );
      return;
    }

    setStorageMode("cloud");
    const cloud = res.data?.portfolio;
    const cloudUpdatedAt = res.data?.updatedAt;
    cloudUpdatedAtRef.current = cloudUpdatedAt;

    if (!cloud || !hasPortfolioData(cloud)) {
      setStorage(local);
      savePortfolio(local);
      if (
        hasPortfolioData(local) &&
        sessionUserId &&
        !isUploadPromptDismissed(sessionUserId)
      ) {
        setUploadPrompt(local);
      }
      setSyncMessage(null);
      setSyncStatus("synced");
      return;
    }

    setUploadPrompt(null);
    setStorage(cloud);
    savePortfolio(cloud);
    setSyncStatus("synced");
    setSyncMessage(null);
  }, [sessionUserId]);

  useEffect(() => {
    if (authStatus === "loading") return;

    initGenerationRef.current += 1;

    if (!isAuthenticated) {
      setStorageMode("anonymous");
      setStorage(loadPortfolio());
      setSyncStatus("idle");
      setSyncMessage(null);
      setUploadPrompt(null);
      cloudUpdatedAtRef.current = undefined;
      return;
    }

    setStorageMode("cloud");
    void initCloudStorage();
  }, [authStatus, isAuthenticated, session?.user?.id, initCloudStorage]);

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

  const add = useCallback(
    (input: CreateHoldingInput): string | null => {
      if (!storage) return null;
      const next = addHolding(storage, input);
      const created = next.holdings[next.holdings.length - 1];
      persist(next);
      return created?.id ?? null;
    },
    [storage, persist]
  );

  const edit = useCallback(
    (input: EditHoldingInput) => {
      if (!storage) return;
      persist(editHolding(storage, input));
    },
    [storage, persist]
  );

  const sell = useCallback(
    (input: SellHoldingInput) => {
      if (!storage) return;
      persist(sellHolding(storage, input));
    },
    [storage, persist]
  );

  const remove = useCallback(
    (id: string) => {
      if (!storage) return;
      persist(removeHolding(storage, id));
    },
    [storage, persist]
  );

  const setManualPrice = useCallback(
    (id: string, price: number, priceDate: string) => {
      if (!storage) return;
      persist(
        applyPriceUpdate(storage, id, price, priceDate, "manual", {
          clearError: true,
        })
      );
    },
    [storage, persist]
  );

  const updateOne = useCallback(
    async (id: string): Promise<boolean> => {
      if (!storage) return false;
      const holding = storage.holdings.find((h) => h.id === id);
      if (!holding) return false;

      const res = await fetchPriceUpdate(holdingToUpdateRequest(holding));
      if (isPriceError(res)) {
        persist(updateHolding(storage, id, { lastError: res.error }));
        return false;
      }

      persist(
        applyPriceUpdate(storage, id, res.price, res.priceDate, "api", {
          name: res.name,
          clearError: true,
        })
      );
      return true;
    },
    [storage, persist]
  );

  const updateAll = useCallback(async () => {
    if (!storage || storage.holdings.length === 0) return;

    setBatchStatus("loading");
    setBatchMessage(null);

    try {
      const batch = await fetchBatchPriceUpdate(storage.holdings);
      let next = storage;
      let okCount = 0;

      for (const item of batch.results) {
        if (item.ok && item.data) {
          okCount++;
          next = applyPriceUpdate(
            next,
            item.holdingId,
            item.data.price,
            item.data.priceDate,
            "api",
            { name: item.data.name, clearError: true }
          );
        } else {
          next = updateHolding(next, item.holdingId, {
            lastError: item.error ?? "更新失敗",
          });
        }
      }

      next = updateSettings(next, {
        lastBatchUpdateAt: batch.updatedAt,
      });
      persist(next);

      const failCount = batch.results.length - okCount;
      if (failCount === 0) {
        setBatchStatus("done");
        setBatchMessage(`已更新 ${okCount} 筆持倉`);
      } else if (okCount > 0) {
        setBatchStatus("partial");
        setBatchMessage(`成功 ${okCount} 筆，失敗 ${failCount} 筆`);
      } else {
        setBatchStatus("error");
        setBatchMessage("全部更新失敗，請稍後重試或手動輸入");
      }
    } catch {
      setBatchStatus("error");
      setBatchMessage("網路錯誤，無法連線至更新 API");
    }
  }, [storage, persist]);

  const setAutoUpdate = useCallback(
    (enabled: boolean) => {
      if (!storage) return;
      persist(updateSettings(storage, { autoUpdateEnabled: enabled }));
    },
    [storage, persist]
  );

  const importPriceHistory = useCallback(
    async (
      holdingId: string,
      range: ChartRange
    ): Promise<{ ok: boolean; count?: number; error?: string }> => {
      if (!storage) return { ok: false, error: "尚未載入資料" };
      const holding = storage.holdings.find((h) => h.id === holdingId);
      if (!holding) return { ok: false, error: "找不到持倉" };

      try {
        const points = await fetchHoldingHistoryPoints(holding, range);
        persist(applyImportedPriceHistory(storage, holdingId, points));
        return { ok: true, count: points.length };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "載入歷史失敗";
        persist(updateHolding(storage, holdingId, { lastError: message }));
        return { ok: false, error: message };
      }
    },
    [storage, persist]
  );

  const refreshPortfolioForRange = useCallback(
    async (
      range: ChartRange
    ): Promise<{ ok: boolean; message?: string; error?: string }> => {
      if (!storage || storage.holdings.length === 0) {
        return { ok: false, error: "尚無持倉" };
      }

      const rangeLabel = getChartRangeLabel(range);
      setBatchStatus("loading");
      setBatchMessage("正在更新全部現價…");

      let next = storage;
      let priceOk = 0;
      let priceFail = 0;

      try {
        const batch = await fetchBatchPriceUpdate(next.holdings);
        for (const item of batch.results) {
          if (item.ok && item.data) {
            priceOk++;
            next = applyPriceUpdate(
              next,
              item.holdingId,
              item.data.price,
              item.data.priceDate,
              "api",
              { name: item.data.name, clearError: true }
            );
          } else {
            priceFail++;
            next = updateHolding(next, item.holdingId, {
              lastError: item.error ?? "更新失敗",
            });
          }
        }
      } catch {
        setBatchStatus("error");
        setBatchMessage("更新現價失敗，請檢查網路");
        return { ok: false, error: "更新現價失敗" };
      }

      // 現價批次更新與歷史股價皆打 TWSE，稍候再載入歷史以降低限流
      await new Promise((r) => setTimeout(r, 1500));

      setBatchMessage(`正在載入「${rangeLabel}」歷史資料…`);

      let historyOk = 0;
      let historyFail = 0;
      let historySkip = 0;

      const importable = next.holdings.filter(canImportHistory);
      historySkip = next.holdings.length - importable.length;

      const historyResults = await fetchHistoryForHoldings(importable, range);
      for (const result of historyResults) {
        if (result.ok) {
          next = applyImportedPriceHistory(next, result.holdingId, result.points);
          historyOk++;
        } else {
          next = updateHolding(next, result.holdingId, {
            lastError: result.error,
          });
          historyFail++;
        }
      }

      next = updateSettings(next, {
        lastBatchUpdateAt: new Date().toISOString(),
      });
      persist(next);

      const parts: string[] = [];
      if (priceOk > 0) parts.push(`現價已更新 ${priceOk} 筆`);
      if (priceFail > 0) parts.push(`現價失敗 ${priceFail} 筆`);
      if (historyOk > 0) {
        parts.push(`${rangeLabel}歷史已載入 ${historyOk} 筆`);
      }
      if (historyFail > 0) parts.push(`歷史失敗 ${historyFail} 筆`);
      if (historySkip > 0) parts.push(`略過上櫃 ${historySkip} 筆`);

      const message = parts.join("；") || "無可更新項目";
      const ok = priceOk > 0 || historyOk > 0;

      if (!ok) {
        setBatchStatus("error");
        setBatchMessage(message);
        return { ok: false, error: message };
      }

      setBatchStatus(
        priceFail > 0 || historyFail > 0 ? "partial" : "done"
      );
      setBatchMessage(message);
      return { ok: true, message };
    },
    [storage, persist]
  );

  const importFundHistory = importPriceHistory;

  const importPortfolio = useCallback(
    (incoming: PortfolioStorage, mode: PortfolioImportMode) => {
      if (!storage) return;
      const next = applyImportMode(storage, incoming, mode);
      persist(next);
    },
    [storage, persist]
  );

  const refreshFromCloud = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      setSyncMessage("請先登入 Google");
      setSyncStatus("error");
      return false;
    }

    setSyncStatus("syncing");
    setSyncMessage("正在從雲端載入…");
    const res = await fetchCloudPortfolio();

    if (!res.ok) {
      setSyncStatus("error");
      setSyncMessage(res.error);
      return false;
    }

    const cloud = res.data?.portfolio;
    if (!cloud || !hasPortfolioData(cloud)) {
      setSyncStatus("error");
      setSyncMessage("雲端尚無投資組合資料");
      return false;
    }

    cloudUpdatedAtRef.current = res.data?.updatedAt;
    setStorageMode("cloud");
    applyStorage(cloud, { skipCloud: true });
    setSyncStatus("synced");
    setSyncMessage("已從雲端載入最新資料");
    return true;
  }, [isAuthenticated, applyStorage]);

  const handleUploadPromptConfirm = useCallback(async () => {
    if (!uploadPrompt) return;
    const data = uploadPrompt;
    setUploadPrompt(null);
    applyStorage(data, { skipCloud: true });
    await uploadToCloud(data);
  }, [uploadPrompt, uploadToCloud, applyStorage]);

  const handleUploadPromptDismiss = useCallback(() => {
    if (sessionUserId) setUploadPromptDismissed(sessionUserId);
    setUploadPrompt(null);
  }, [sessionUserId]);

  const value = useMemo(
    () => ({
      ready: storage !== null && authStatus !== "loading",
      storageMode,
      syncStatus,
      syncMessage,
      holdings,
      sales,
      summary,
      storage: storage ?? loadPortfolio(),
      batchStatus,
      batchMessage,
      add,
      edit,
      sell,
      remove,
      setManualPrice,
      updateOne,
      updateAll,
      refreshPortfolioForRange,
      importPriceHistory,
      importFundHistory,
      setAutoUpdate,
      importPortfolio,
      refreshFromCloud,
    }),
    [
      storage,
      authStatus,
      storageMode,
      syncStatus,
      syncMessage,
      holdings,
      sales,
      summary,
      batchStatus,
      batchMessage,
      add,
      edit,
      sell,
      remove,
      setManualPrice,
      updateOne,
      updateAll,
      refreshPortfolioForRange,
      importPriceHistory,
      importFundHistory,
      setAutoUpdate,
      importPortfolio,
      refreshFromCloud,
    ]
  );

  return (
    <PortfolioContext.Provider value={value}>
      {uploadPrompt && (
        <CloudUploadPromptModal
          local={uploadPrompt}
          onUpload={() => void handleUploadPromptConfirm()}
          onKeepLocalOnly={handleUploadPromptDismiss}
        />
      )}
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio 必須在 PortfolioProvider 內使用");
  return ctx;
}
