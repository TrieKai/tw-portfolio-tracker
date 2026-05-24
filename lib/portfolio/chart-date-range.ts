/** 趨勢圖時間區間 */
export type ChartRange =
  | "7d"
  | "30d"
  | "2m"
  | "3m"
  | "1q"
  | "1y"
  | "ytd"
  | "all";

export const CHART_RANGE_OPTIONS: { key: ChartRange; label: string }[] = [
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "2m", label: "2 個月" },
  { key: "3m", label: "3 個月" },
  { key: "1q", label: "一季" },
  { key: "1y", label: "一年" },
  { key: "ytd", label: "今年度" },
  { key: "all", label: "全部" },
];

export const CHART_RANGE_VALUES = CHART_RANGE_OPTIONS.map((o) => o.key);

export function getChartRangeLabel(range: ChartRange): string {
  return CHART_RANGE_OPTIONS.find((o) => o.key === range)?.label ?? range;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subtractDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

/** 當季第一天（1/1、4/1、7/1、10/1） */
function startOfQuarter(d: Date): Date {
  const quarter = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), quarter * 3, 1);
}

/** 圖表區間 → ISO 起訖日（YYYY-MM-DD） */
export function chartRangeToIsoDates(
  range: ChartRange,
  options?: { buyDate?: string; maxAllDays?: number }
): { startDate: string; endDate: string } {
  const end = new Date();
  const endDate = toIsoDate(end);
  const maxAll = options?.maxAllDays ?? 365;

  if (range === "all") {
    const start = options?.buyDate
      ? new Date(options.buyDate)
      : subtractDays(end, maxAll);
    if (Number.isNaN(start.getTime())) {
      start.setTime(subtractDays(end, maxAll).getTime());
    }
    const earliest = subtractDays(end, maxAll);
    if (start < earliest) start.setTime(earliest.getTime());
    return { startDate: toIsoDate(start), endDate };
  }

  let start: Date;
  switch (range) {
    case "7d":
      start = subtractDays(end, 7);
      break;
    case "30d":
      start = subtractDays(end, 30);
      break;
    case "2m":
      start = subtractDays(end, 60);
      break;
    case "3m":
      start = subtractDays(end, 90);
      break;
    case "1q":
      start = startOfQuarter(end);
      break;
    case "1y":
      start = subtractDays(end, 365);
      break;
    case "ytd":
      start = new Date(end.getFullYear(), 0, 1);
      break;
    default:
      start = subtractDays(end, 30);
  }

  return { startDate: toIsoDate(start), endDate };
}

/** 列出 ISO 起訖日之間每個月的首日 YYYYMMDD（供 TWSE 月報 API） */
export function listMonthFirstDaysIso(
  startIso: string,
  endIso: string
): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    months.push(`${y}${m}01`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}
