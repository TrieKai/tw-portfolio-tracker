/** ISO 日期 YYYY-MM-DD ↔ Date（本地時區，避免 UTC 偏移） */
export function parseIsoDate(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return undefined;
  }
  return date;
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

/** 當月第一天 ISO YYYY-MM-DD */
export function startOfMonthIso(ref: Date = new Date()): string {
  return toIsoDate(new Date(ref.getFullYear(), ref.getMonth(), 1));
}

/** 當月 YYYY-MM（供 sellDate 前綴比對） */
export function currentYearMonthPrefix(ref: Date = new Date()): string {
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 當月顯示用，例如「2025年5月」 */
export function formatCurrentMonthZh(ref: Date = new Date()): string {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(ref);
}

/** 顯示用：2025年5月24日 */
export function formatIsoDateZh(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
