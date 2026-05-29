"use client";

import type { ChartRange } from "@/lib/portfolio/calculations";
import { CHART_RANGE_OPTIONS } from "@/lib/portfolio/chart-date-range";

/** 趨勢區間：手機橫向捲動、桌面換行 */
export function ChartRangePicker({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
}) {
  return (
    <div className="scroll-x-chips w-full sm:w-auto">
      <div className="flex w-max gap-1 sm:w-auto sm:flex-wrap">
        {CHART_RANGE_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm transition touch-target ${
              value === key
                ? "bg-accent-dim font-medium text-accent"
                : "text-muted hover:bg-surface-raised"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
