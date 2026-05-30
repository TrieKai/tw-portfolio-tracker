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
import {
  CloudMergeModal,
  portfolioItemCount,
} from "@/components/auth/CloudMergeModal";
import {
  canImportHistory,
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

const SYNC_DEBOUNCE_MS = 900;

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
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus } = useSession();
  const isAuthenticated = authStatus === "authenticated";

  const [storage, setStorage] = useState<PortfolioStorage | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>("anonymous");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<UpdateStatus>("idle");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{
    local: PortfolioStorage;
    cloud: PortfolioStorage;
  } | null>(null);

  const cloudUpdatedAtRef = useRef<string | undefined>(undefined);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const scheduleCloudSync = useCallback(
    (next: PortfolioStorage) => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        void flushCloudSync(next);
      }, SYNC_DEBOUNCE_MS);
    },
    [flushCloudSync]
  );

  const applyStorage = useCallback(
    (next: PortfolioStorage, options?: { skipCloud?: boolean }) => {
      setStorage(next);
      savePortfolio(next);
      if (storageMode === "cloud" && isAuthenticated && !options?.skipCloud) {
        scheduleCloudSync(next);
      }
    },
    [storageMode, isAuthenticated, scheduleCloudSync]
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
      setStorageMode("anonymous");
      setStorage(local);
      setSyncStatus("error");
      setSyncMessage(res.error);
      return;
    }

    setStorageMode("cloud");
    const cloud = res.data?.portfolio;
    const cloudUpdatedAt = res.data?.updatedAt;
    cloudUpdatedAtRef.current = cloudUpdatedAt;

    if (!cloud || !hasPortfolioData(cloud)) {
      if (hasPortfolioData(local)) {
        setStorage(local);
        savePortfolio(local);
        await uploadToCloud(local);
      } else {
        setStorage(local);
      }
      setSyncStatus("synced");
      setSyncMessage(null);
      return;
    }

    if (!hasPortfolioData(local)) {
      setStorage(cloud);
      savePortfolio(cloud);
      setSyncStatus("synced");
      setSyncMessage(null);
      return;
    }

    setMergePrompt({ local, cloud });
    setStorage(cloud);
    savePortfolio(cloud);
    setSyncStatus("synced");
    setSyncMessage(null);
  }, [uploadToCloud]);

  useEffect(() => {
    if (authStatus === "loading") return;

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    initGenerationRef.current += 1;

    if (!isAuthenticated) {
      setStorageMode("anonymous");
      setStorage(loadPortfolio());
      setSyncStatus("idle");
      setSyncMessage(null);
      setMergePrompt(null);
      cloudUpdatedAtRef.current = undefined;
      return;
    }

    void initCloudStorage();
  }, [authStatus, isAuthenticated, initCloudStorage]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

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

      setBatchMessage(`正在載入「${rangeLabel}」歷史資料…`);

      let historyOk = 0;
      let historyFail = 0;
      let historySkip = 0;

      for (const h of next.holdings) {
        if (!canImportHistory(h)) {
          historySkip++;
          continue;
        }
        try {
          const points = await fetchHoldingHistoryPoints(h, range);
          next = applyImportedPriceHistory(next, h.id, points);
          historyOk++;
        } catch (error) {
          historyFail++;
          const message =
            error instanceof Error ? error.message : "載入歷史失敗";
          next = updateHolding(next, h.id, { lastError: message });
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

  const handleMergeLocal = useCallback(async () => {
    if (!mergePrompt) return;
    const { local } = mergePrompt;
    setMergePrompt(null);
    applyStorage(local, { skipCloud: true });
    await uploadToCloud(local);
  }, [mergePrompt, applyStorage, uploadToCloud]);

  const handleMergeCloud = useCallback(() => {
    if (!mergePrompt) return;
    const { cloud } = mergePrompt;
    setMergePrompt(null);
    applyStorage(cloud, { skipCloud: true });
    void uploadToCloud(cloud);
  }, [mergePrompt, applyStorage, uploadToCloud]);

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
    ]
  );

  return (
    <PortfolioContext.Provider value={value}>
      {mergePrompt && (
        <CloudMergeModal
          localCount={portfolioItemCount(mergePrompt.local)}
          cloudCount={portfolioItemCount(mergePrompt.cloud)}
          onChooseLocal={handleMergeLocal}
          onChooseCloud={handleMergeCloud}
          onDismiss={() => setMergePrompt(null)}
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
