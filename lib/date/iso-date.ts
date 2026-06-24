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

/** ISO 日期往前／往後 N 天（本地時區） */
export function addDaysToIsoDate(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
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

/** YYYY-MM 顯示用，例如「2025年5月」 */
export function formatYearMonthZh(monthPrefix: string): string {
  const [y, m] = monthPrefix.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return monthPrefix;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, 1));
}

/** ISO 日期取 YYYY-MM */
export function monthPrefixFromIsoDate(iso: string): string {
  return iso.slice(0, 7);
}

/** 月份 YYYY-MM 的第一天 ISO */
export function startOfMonthIsoFromPrefix(monthPrefix: string): string {
  return `${monthPrefix}-01`;
}

/** 月份 YYYY-MM 的最後一天 ISO */
export function endOfMonthIsoFromPrefix(monthPrefix: string): string {
  const [y, m] = monthPrefix.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return startOfMonthIsoFromPrefix(monthPrefix);
  return toIsoDate(new Date(y, m, 0));
}

/**
 * 月份區間的結束日：當月為今天，其餘為該月最後一天
 */
export function endDateForMonthPrefix(
  monthPrefix: string,
  ref: Date = new Date()
): string {
  const today = todayIsoDate();
  if (monthPrefix === currentYearMonthPrefix(ref)) return today;
  return endOfMonthIsoFromPrefix(monthPrefix);
}

/** 今年 YYYY-01 */
export function currentYearJanuaryPrefix(ref: Date = new Date()): string {
  return `${ref.getFullYear()}-01`;
}

/** 由早到晚列出月份 YYYY-MM（含起訖） */
export function listMonthPrefixesAscending(
  fromPrefix: string,
  toPrefix: string
): string[] {
  const [fy, fm] = fromPrefix.split("-").map(Number);
  const [ty, tm] = toPrefix.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [];

  const result: string[] = [];
  let y = fy;
  let m = fm;

  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
}

/** 由晚到早列出月份 YYYY-MM（含起訖） */
export function listMonthPrefixesDescending(
  fromPrefix: string,
  toPrefix: string
): string[] {
  return listMonthPrefixesAscending(fromPrefix, toPrefix).reverse();
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
