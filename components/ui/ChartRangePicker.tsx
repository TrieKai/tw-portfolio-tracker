"use client";

import type { ChartRange } from "@/lib/portfolio/calculations";
import { CHART_RANGE_OPTIONS } from "@/lib/portfolio/chart-date-range";

/** 趨勢區間可換行，讓各區間在窄螢幕保持可見。 */
export function ChartRangePicker({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
}) {
  return (
    <div role="group" aria-label="趨勢區間" className="flex flex-wrap gap-1">
      {CHART_RANGE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
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
  );
}
