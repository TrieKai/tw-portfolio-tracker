"use client";

import { formatIsoDateZh, normalizeToIsoDate } from "@/lib/date/iso-date";
import { formatPercent } from "@/lib/portfolio/calculations";
import type { PortfolioSummary } from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

interface TimeTravelBarProps {
  dates: string[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  currentSummary: PortfolioSummary;
  selectedSummary?: PortfolioSummary;
  view?: DashboardCardView;
}

function formatDate(date: string) {
  return formatIsoDateZh(normalizeToIsoDate(date) ?? date);
}

export function TimeTravelBar({
  dates,
  selectedDate,
  onSelectDate,
  currentSummary,
  selectedSummary,
  view = "standard",
}: TimeTravelBarProps) {
  const { formatAmount } = useAmountPrivacy();
  if (dates.length === 0) return null;
  const activeIndex = selectedDate
    ? Math.max(0, dates.indexOf(selectedDate))
    : dates.length - 1;
  const active = selectedDate !== null;
  const tickIndexes = [...new Set(
    [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
      Math.round((dates.length - 1) * ratio)
    )
  )];

  return (
    <section className={`overflow-hidden rounded-2xl border p-4 transition ${
      active
        ? "border-accent/50 bg-accent-dim/40"
        : "border-border bg-surface"
    }`} aria-label="資產時間旅行">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-surface-raised text-muted" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 7v5h4" />
            </svg>
          </span>
          <div>
            <p className="font-semibold">時間旅行</p>
            <p className="text-xs text-muted">
              {active ? formatDate(dates[activeIndex]) : "拖曳時間軸，回看資產當時的樣子"}
            </p>
          </div>
        </div>
        {active && (
          <button type="button" onClick={() => onSelectDate(null)} className="btn-secondary">
            回到現在
          </button>
        )}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span className="py-1.5 text-xs text-muted" aria-hidden>過去</span>
        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <input
            type="range"
            min={0}
            max={Math.max(0, dates.length - 1)}
            value={activeIndex}
            onChange={(event) => onSelectDate(dates[Number(event.target.value)])}
            className="block h-6 w-full cursor-pointer accent-[var(--accent)]"
            aria-label="選擇歷史日期"
            aria-valuetext={formatDate(dates[activeIndex])}
          />
          <div className={`history-ticks relative h-7 ${view === "compact" ? "hidden" : ""}`} aria-label="歷史日期刻度">
            {tickIndexes.map((index) => {
              const position = dates.length > 1 ? (index / (dates.length - 1)) * 100 : 0;
              const align = index === 0
                ? "translate-x-0 items-start text-left"
                : index === dates.length - 1
                  ? "-translate-x-full items-end text-right"
                  : "-translate-x-1/2 items-center text-center";
              return (
                <button
                  key={`${dates[index]}-${index}`}
                  type="button"
                  onClick={() => onSelectDate(dates[index])}
                  className={`absolute top-0 flex min-h-6 flex-col text-xs text-muted transition hover:text-accent ${align} ${
                    index > 0 && index < dates.length - 1 ? "history-tick-intermediate" : ""
                  }`}
                  style={{ left: `${position}%` }}
                  aria-label={formatDate(dates[index])}
                >
                  <span className="mb-0.5 h-2 w-px bg-border" aria-hidden />
                  <span className="whitespace-nowrap">
                    {index === 0 || dates[index].slice(0, 4) !== dates[0].slice(0, 4)
                      ? dates[index].replaceAll("-", "/")
                      : dates[index].slice(5).replace("-", "/")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(dates[dates.length - 1])}
          className="min-h-6 text-xs font-medium text-accent hover:underline"
        >
          最近
        </button>
      </div>
      {active && (
        <div className="mt-3 border-t border-border/70 pt-3">
          {selectedSummary && (
            <div className="grid gap-2 sm:grid-cols-3">
              <TimeMetric label="當時總資產" value={formatAmount(selectedSummary.totalValue)} />
              <TimeMetric
                label="自當時至今"
                value={formatAmount(currentSummary.totalValue - selectedSummary.totalValue)}
                tone={currentSummary.totalValue - selectedSummary.totalValue >= 0 ? "gain" : "loss"}
                sub={selectedSummary.totalValue > 0 ? formatPercent(((currentSummary.totalValue - selectedSummary.totalValue) / selectedSummary.totalValue) * 100) : undefined}
              />
              <TimeMetric label="當時持倉" value={`${selectedSummary.holdingCount} 筆`} sub={`未實現 ${formatPercent(selectedSummary.totalReturnRate)}`} />
            </div>
          )}
          <p className={`mt-3 text-[11px] text-muted ${view === "compact" ? "hidden" : ""}`}>
            以目前仍持有的部位與當日最近價格回看；資產差異也可能包含後續投入與賣出，不等同投資報酬。
          </p>
        </div>
      )}
    </section>
  );
}

function TimeMetric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl bg-surface-raised/70 px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}
