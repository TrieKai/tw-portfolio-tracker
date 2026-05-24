"use client";

import type { ManualNavRecord } from "@/lib/client/types";

interface HistoryListProps {
  items: ManualNavRecord[];
  onSelect: (record: ManualNavRecord) => void;
  onClear: () => void;
}

export function HistoryList({ items, onSelect, onClear }: HistoryListProps) {
  if (items.length === 0) return null;

  return (
    <section className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">本機手動紀錄</h3>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-500 transition hover:text-rose-400"
        >
          清除全部
        </button>
      </div>
      <ul className="divide-y divide-surface-border">
        {items.map((item) => (
          <li key={`${item.fundCode}-${item.savedAt}`}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="flex w-full items-center justify-between gap-4 py-3 text-left transition hover:bg-white/[0.02]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">
                  {item.fundName}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  {item.fundCode} · {item.navDate}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-sm text-accent">
                {item.nav.toLocaleString("zh-TW", { minimumFractionDigits: 2 })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
