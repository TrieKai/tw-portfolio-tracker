import type { PortfolioStorage } from "@/lib/types/holding";
import { mergePriceHistory } from "@/lib/storage/portfolio-store";
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
  return `${state.holdings.length} 筆持倉、${state.sales.length} 筆賣出紀錄、${historyKeys} 組價格歷史`;
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
    error: "無法辨識的備份格式（需為本 App 匯出的 JSON 或 version:1 的持倉資料）",
  };
}

/** 合併匯入：同 id 的持倉／賣出以匯入檔為準；價格歷史合併 */
export function mergePortfolioStorage(
  current: PortfolioStorage,
  incoming: PortfolioStorage
): PortfolioStorage {
  const holdingMap = new Map(current.holdings.map((h) => [h.id, h]));
  for (const h of incoming.holdings) {
    holdingMap.set(h.id, h);
  }

  const saleMap = new Map(current.sales.map((s) => [s.id, s]));
  for (const s of incoming.sales) {
    saleMap.set(s.id, s);
  }

  let priceHistory = { ...current.priceHistory };
  for (const [holdingId, points] of Object.entries(incoming.priceHistory)) {
    if (!Array.isArray(points) || points.length === 0) continue;
    priceHistory = mergePriceHistory(priceHistory, holdingId, points);
  }

  return {
    version: 1,
    holdings: [...holdingMap.values()],
    sales: [...saleMap.values()],
    priceHistory,
    settings: {
      ...incoming.settings,
      theme: current.settings.theme ?? incoming.settings.theme,
      autoUpdateEnabled: current.settings.autoUpdateEnabled,
    },
  };
}

export function applyImportMode(
  current: PortfolioStorage,
  incoming: PortfolioStorage,
  mode: PortfolioImportMode
): PortfolioStorage {
  if (mode === "replace") {
    return {
      ...incoming,
      settings: {
        ...incoming.settings,
        theme: current.settings.theme ?? incoming.settings.theme,
      },
    };
  }
  return mergePortfolioStorage(current, incoming);
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
