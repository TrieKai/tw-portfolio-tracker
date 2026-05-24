import type { ManualNavRecord } from "./types";

const STORAGE_KEY = "fund-nav-manual-history";
const MAX_ITEMS = 10;

export function loadManualHistory(): ManualNavRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManualNavRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveManualRecord(record: ManualNavRecord): ManualNavRecord[] {
  const prev = loadManualHistory();
  const filtered = prev.filter((r) => r.fundCode !== record.fundCode);
  const next = [record, ...filtered].slice(0, MAX_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
