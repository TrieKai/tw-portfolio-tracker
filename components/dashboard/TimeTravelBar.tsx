"use client";

interface TimeTravelBarProps {
  dates: string[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function TimeTravelBar({
  dates,
  selectedDate,
  onSelectDate,
}: TimeTravelBarProps) {
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
    <section className={`mb-6 overflow-hidden rounded-2xl border p-4 transition ${
      active
        ? "border-accent/50 bg-accent-dim/40 shadow-lg shadow-accent/5"
        : "border-border bg-surface"
    }`} aria-label="資產時間旅行">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${active ? "bg-accent text-white" : "bg-surface-raised text-muted"}`} aria-hidden>
            ◷
          </span>
          <div>
            <p className="font-semibold">時間旅行</p>
            <p className="text-xs text-muted">
              {active ? formatDate(dates[activeIndex]) : "拖曳時間軸，回看資產當時的樣子"}
            </p>
          </div>
        </div>
        {active && (
          <button type="button" onClick={() => onSelectDate(null)} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white">
            回到現在
          </button>
        )}
      </div>

      <div className="mt-4 flex items-start gap-3">
        <span className="text-xs text-muted" aria-hidden>過去</span>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, dates.length - 1)}
            value={activeIndex}
            onChange={(event) => onSelectDate(dates[Number(event.target.value)])}
            className="block h-2 w-full cursor-pointer accent-[var(--accent)]"
            aria-label="選擇歷史日期"
            aria-valuetext={formatDate(dates[activeIndex])}
          />
          <div className="relative mt-1 h-8" aria-label="歷史日期刻度">
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
                  className={`absolute top-0 flex flex-col text-[10px] text-muted transition hover:text-accent ${align}`}
                  style={{ left: `${position}%` }}
                  title={formatDate(dates[index])}
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
          className="text-xs font-medium text-accent hover:underline"
        >
          最近
        </button>
      </div>
      {active && (
        <p className="mt-3 text-[11px] text-muted">
          以目前仍持有的部位與當日最近價格回看；不推測已完全賣出的舊持倉。
        </p>
      )}
    </section>
  );
}
