import type { XAxisProps } from "recharts";

/** 以完整日期計算實際間隔，跨年時在刻度上一起顯示年份。 */
export function historyDateAxis(firstDate: string, lastDate: string): XAxisProps {
  const spansYears = firstDate.slice(0, 4) !== lastDate.slice(0, 4);
  return {
    dataKey: "timestamp",
    type: "number",
    scale: "utc",
    domain: ["dataMin", "dataMax"],
    interval: "preserveStartEnd",
    tick: { fontSize: 11 },
    stroke: "var(--muted)",
    tickFormatter: (value: number | Date) => new Date(Number(value)).toISOString().slice(spansYears ? 2 : 5, 10),
  };
}

const compactAmount = new Intl.NumberFormat("zh-TW", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatAmountAxisTick(value: number): string {
  return compactAmount.format(value);
}
