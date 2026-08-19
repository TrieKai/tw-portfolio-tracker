"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DividendModal } from "@/components/calendar/DividendModal";
import {
  PnlDetailPanel,
  type PnlDetailSelection,
} from "@/components/calendar/PnlDetailPanel";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  addDaysToIsoDate,
  currentYearMonthPrefix,
  formatYearMonthZh,
  parseIsoDate,
  todayIsoDate,
  toIsoDate,
} from "@/lib/date/iso-date";
import {
  buildTradingCalendarGrid,
  type TradingCalendarRow,
} from "@/lib/date/trading-calendar";
import { formatCurrency } from "@/lib/portfolio/calculations";
import {
  buildPnlCalendar,
  type PnlCalendarDay,
  type PnlCalendarFilter,
  type PnlCalendarResult,
  type PnlCalendarWeek,
} from "@/lib/portfolio/pnl-calendar";
import type { ChartRange } from "@/lib/portfolio/chart-date-range";
import { usePortfolio } from "@/providers/PortfolioProvider";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五"] as const;

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const next = new Date(year, monthNumber - 1 + amount, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function signedCurrency(value: number): string {
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function compactPnl(value: number): string {
  const absolute = Math.abs(value);
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  if (absolute >= 100_000_000) {
    return `${prefix}${(absolute / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  }
  if (absolute >= 10_000) {
    return `${prefix}${(absolute / 10_000).toFixed(1).replace(/\.0$/, "")}萬`;
  }
  return `${prefix}${Math.round(absolute).toLocaleString("zh-TW")}`;
}

function pnlClass(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted";
}

function weekStartForDate(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const weekday = date.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return toIsoDate(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset)
  );
}

function filterFromValue(value: string): PnlCalendarFilter {
  if (value === "stock" || value === "fund") {
    return { kind: "assetType", assetType: value };
  }
  if (value.startsWith("holding:")) {
    return { kind: "holding", holdingId: value.slice("holding:".length) };
  }
  return { kind: "investment" };
}

function dayStatus(day: PnlCalendarDay): string | null {
  if (day.isProvisional) return "暫";
  if (day.quality === "estimated") return "估";
  if (day.quality === "partial") {
    return `${day.pricedHoldingCount}/${day.totalHoldingCount}`;
  }
  return null;
}

function heatStyle(day: PnlCalendarDay, maximum: number): CSSProperties {
  if (day.pnl === 0 || maximum <= 0) return {};
  const intensity = Math.round(8 + (Math.abs(day.pnl) / maximum) * 24);
  const color = day.pnl > 0 ? "var(--gain)" : "var(--loss)";
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${intensity}%, var(--surface))`,
  };
}

function CalendarDayCell({
  date,
  day,
  maximum,
  onSelect,
}: {
  date: string | null;
  day?: PnlCalendarDay;
  maximum: number;
  onSelect: (day: PnlCalendarDay) => void;
}) {
  if (!date) {
    return <div className="min-h-20 rounded-xl border border-border/50 bg-surface/30 sm:min-h-28" />;
  }
  const status = day ? dayStatus(day) : null;
  return (
    <button
      type="button"
      disabled={!day}
      onClick={() => day && onSelect(day)}
      className="relative min-h-20 min-w-0 rounded-xl border border-border bg-surface p-1.5 text-left transition hover:border-accent/50 disabled:cursor-default disabled:hover:border-border sm:min-h-28 sm:p-3"
      style={day ? heatStyle(day, maximum) : undefined}
      aria-label={
        day
          ? `${date}，損益 ${signedCurrency(day.pnl)}，報酬 ${day.returnRate.toFixed(2)}%`
          : `${date}，無損益資料`
      }
    >
      <span
        className={`block text-right text-xs sm:text-sm ${
          day ? "text-foreground" : "text-muted"
        }`}
      >
        {Number(date.slice(-2))}
      </span>
      {day ? (
        <span className="mt-2 block min-w-0 sm:mt-5">
          <span className="block truncate text-center text-[11px] font-semibold tabular-nums text-foreground sm:text-base">
            {compactPnl(day.pnl)}
          </span>
          <span className="mt-1 hidden text-center text-sm tabular-nums text-foreground md:block">
            {day.returnRate > 0 ? "+" : ""}
            {day.returnRate.toFixed(2)}%
          </span>
        </span>
      ) : (
        <span className="mt-3 block text-center text-sm text-muted/70">—</span>
      )}
      {status ? (
        <span className="absolute left-1 top-1 rounded bg-surface-raised/90 px-1 py-0.5 text-[9px] font-medium text-muted sm:left-2 sm:top-2 sm:text-[10px]">
          {status}
        </span>
      ) : null}
    </button>
  );
}

function CalendarGrid({
  rows,
  calendar,
  weekendEvents,
  onSelectDay,
  onSelectWeek,
}: {
  rows: TradingCalendarRow[];
  calendar: PnlCalendarResult;
  weekendEvents: Map<string, number>;
  onSelectDay: (day: PnlCalendarDay) => void;
  onSelectWeek: (week: PnlCalendarWeek) => void;
}) {
  const dayByDate = new Map(calendar.days.map((day) => [day.date, day]));
  const weekByStart = new Map(calendar.weeks.map((week) => [week.startDate, week]));
  const maximum = calendar.days.reduce(
    (current, day) => Math.max(current, Math.abs(day.pnl)),
    0
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5 px-1 text-center text-xs font-medium text-muted sm:gap-2 sm:text-sm md:grid-cols-[repeat(5,minmax(0,1fr))_minmax(7.5rem,.8fr)]">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="py-2">
            {label}
          </span>
        ))}
        <span className="hidden py-2 md:block">週損益</span>
      </div>

      {rows.map((row, index) => {
        const week = weekByStart.get(row.weekStartDate);
        const weekendEventCount = weekendEvents.get(row.weekStartDate) ?? 0;
        const selectableWeek =
          week ??
          (weekendEventCount > 0
            ? {
                startDate: row.weekStartDate,
                endDate: row.weekEndDate,
                pnl: 0,
                returnRate: 0,
                dataDayCount: 0,
              }
            : undefined);
        return (
          <div
            key={row.weekStartDate}
            className="grid grid-cols-5 gap-1.5 sm:gap-2 md:grid-cols-[repeat(5,minmax(0,1fr))_minmax(7.5rem,.8fr)]"
          >
            {row.dates.map((date, dayIndex) => (
              <CalendarDayCell
                key={date ?? `${row.weekStartDate}-${dayIndex}`}
                date={date}
                day={date ? dayByDate.get(date) : undefined}
                maximum={maximum}
                onSelect={onSelectDay}
              />
            ))}
            <button
              type="button"
              disabled={!week && weekendEventCount === 0}
              onClick={() => selectableWeek && onSelectWeek(selectableWeek)}
              className="col-span-5 flex min-h-12 items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-left disabled:cursor-default md:col-span-1 md:min-h-28 md:flex-col md:items-stretch md:justify-center md:text-center"
              aria-label={`第 ${index + 1} 週損益`}
            >
              <span className="text-xs text-muted md:mb-2">第 {index + 1} 週</span>
              <span className={`font-semibold tabular-nums ${week ? pnlClass(week.pnl) : "text-muted"}`}>
                {week ? compactPnl(week.pnl) : "—"}
              </span>
              {week ? (
                <span className={`hidden text-xs tabular-nums md:block ${pnlClass(week.returnRate)}`}>
                  {week.returnRate > 0 ? "+" : ""}
                  {week.returnRate.toFixed(2)}%
                </span>
              ) : null}
              {weekendEventCount > 0 ? (
                <span className="text-[10px] text-amber-600 dark:text-amber-300">
                  {weekendEventCount} 筆非交易日事件
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  className = "",
  description,
}: {
  label: string;
  value: string;
  className?: string;
  description?: string;
}) {
  return (
    <div className="glass-card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums sm:text-2xl ${className}`}>
        {value}
      </p>
      {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
    </div>
  );
}

function dataRangeForMonth(month: string, currentMonth: string): ChartRange {
  if (month === currentMonth) return "30d";
  if (month.slice(0, 4) === currentMonth.slice(0, 4)) return "ytd";
  return "all";
}

export function PnlCalendarPage() {
  const {
    ready,
    holdings,
    storage,
    addDividend,
    refreshPortfolioForRange,
    batchStatus,
    batchMessage,
  } = usePortfolio();
  const currentMonth = currentYearMonthPrefix();
  const today = todayIsoDate();
  const [month, setMonth] = useState(currentMonth);
  const [filterValue, setFilterValue] = useState("investment");
  const [selection, setSelection] = useState<PnlDetailSelection | null>(null);
  const [dividendOpen, setDividendOpen] = useState(false);
  const autoLoadedRef = useRef(new Set<string>());

  const investmentHoldings = useMemo(
    () => holdings.filter((holding) => holding.assetType !== "property"),
    [holdings]
  );
  const filterHoldings = useMemo(() => {
    const options = new Map(
      investmentHoldings.map((holding) => [
        holding.id,
        { id: holding.id, name: holding.name, symbol: holding.symbol },
      ])
    );
    for (const transaction of storage.transactions) {
      if (!options.has(transaction.holdingId)) {
        options.set(transaction.holdingId, {
          id: transaction.holdingId,
          name: transaction.name,
          symbol: transaction.symbol,
        });
      }
    }
    return Array.from(options.values());
  }, [investmentHoldings, storage.transactions]);
  const filter = useMemo(() => filterFromValue(filterValue), [filterValue]);
  const calendar = useMemo(
    () => buildPnlCalendar(storage, { month, asOfDate: today, filter }),
    [storage, month, today, filter]
  );
  const rows = useMemo(() => buildTradingCalendarGrid(month), [month]);
  const hasSelectedMonthPrices = useMemo(
    () =>
      Object.values(storage.priceHistory).some((points) =>
        points.some((point) => point.date.startsWith(month))
      ),
    [storage.priceHistory, month]
  );
  const weekendEvents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const transaction of storage.transactions) {
      if (!transaction.date.startsWith(month)) continue;
      const date = parseIsoDate(transaction.date);
      if (!date || (date.getDay() !== 0 && date.getDay() !== 6)) continue;
      const weekStart = weekStartForDate(transaction.date);
      counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
    }
    return counts;
  }, [storage.transactions, month]);

  useEffect(() => {
    if (!ready || month !== currentMonth || hasSelectedMonthPrices) return;
    if (investmentHoldings.length === 0) return;
    const key = `${month}:${investmentHoldings.length}`;
    if (autoLoadedRef.current.has(key)) return;
    autoLoadedRef.current.add(key);
    void refreshPortfolioForRange("30d");
  }, [
    ready,
    month,
    currentMonth,
    hasSelectedMonthPrices,
    investmentHoldings.length,
    refreshPortfolioForRange,
  ]);

  if (!ready) return <LoadingSpinner />;

  const loading = batchStatus === "loading";
  const completeness =
    calendar.summary.dataDayCount > 0
      ? (calendar.summary.completeDayCount / calendar.summary.dataDayCount) * 100
      : 0;
  const isEstimatedMonth =
    !storage.pnlTracking.startedAt || month < storage.pnlTracking.startedAt.slice(0, 7);

  function chooseMonth(next: string) {
    if (!next || next > currentMonth) return;
    setMonth(next);
    setSelection(null);
  }

  function selectWeek(week: PnlCalendarWeek) {
    const weekEndWithWeekend = addDaysToIsoDate(week.startDate, 6);
    setSelection({
      kind: "week",
      week,
      days: calendar.days.filter(
        (day) => day.date >= week.startDate && day.date <= weekEndWithWeekend
      ),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="損益日曆"
        description="排除買賣本金，追蹤股票與基金的每日投資表現"
        action={
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => setDividendOpen(true)}
              disabled={investmentHoldings.length === 0}
              className="btn-secondary flex-1 sm:flex-none"
            >
              新增配息
            </button>
            <button
              type="button"
              onClick={() =>
                void refreshPortfolioForRange(dataRangeForMonth(month, currentMonth))
              }
              disabled={loading || investmentHoldings.length === 0}
              className="btn-primary flex-1 sm:flex-none"
            >
              {loading ? "載入中…" : "補齊資料"}
            </button>
          </div>
        }
      />

      <section className="glass-card space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs text-muted">目前月份</p>
            <h2 className="mt-1 text-2xl font-semibold">{formatYearMonthZh(month)}</h2>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={() => chooseMonth(shiftMonth(month, -1))}
              className="btn-secondary touch-target"
              aria-label="上個月"
            >
              ←
            </button>
            <input
              type="month"
              value={month}
              max={currentMonth}
              onChange={(event) => chooseMonth(event.target.value)}
              className="input-field min-w-0 sm:w-40"
              aria-label="選擇月份"
            />
            <button
              type="button"
              onClick={() => chooseMonth(shiftMonth(month, 1))}
              disabled={month >= currentMonth}
              className="btn-secondary touch-target"
              aria-label="下個月"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => chooseMonth(currentMonth)}
              className="btn-secondary col-span-3 sm:col-auto"
            >
              回到本月
            </button>
            <select
              value={filterValue}
              onChange={(event) => {
                setFilterValue(event.target.value);
                setSelection(null);
              }}
              className="input-field col-span-3 sm:w-48"
              aria-label="篩選資產"
            >
              <option value="investment">投資資產</option>
              <option value="stock">股票</option>
              <option value="fund">基金</option>
              {filterHoldings.map((holding) => (
                <option key={holding.id} value={`holding:${holding.id}`}>
                  {holding.name}（{holding.symbol}）
                </option>
              ))}
            </select>
          </div>
        </div>

        {isEstimatedMonth ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            這個月份早於完整追蹤起點，數字僅依目前仍可重建的持倉估算；已結清舊部位不會捏造日損益。
          </p>
        ) : null}
        {batchMessage ? <p className="text-xs text-muted">{batchMessage}</p> : null}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="本月損益"
          value={signedCurrency(calendar.summary.pnl)}
          className={pnlClass(calendar.summary.pnl)}
        />
        <SummaryCard
          label="複利報酬率"
          value={`${calendar.summary.returnRate > 0 ? "+" : ""}${calendar.summary.returnRate.toFixed(2)}%`}
          className={pnlClass(calendar.summary.returnRate)}
        />
        <SummaryCard
          label="獲利／虧損日"
          value={`${calendar.summary.gainDayCount}／${calendar.summary.lossDayCount}`}
          description={`共 ${calendar.summary.dataDayCount} 個估值日`}
        />
        <SummaryCard
          label="資料完整度"
          value={`${completeness.toFixed(0)}%`}
          description={`${calendar.summary.completeDayCount}/${calendar.summary.dataDayCount || 0} 日完整`}
        />
      </section>

      {investmentHoldings.length === 0 && storage.transactions.length === 0 ? (
        <section className="glass-card p-10 text-center">
          <h2 className="text-lg font-semibold">尚無股票或基金</h2>
          <p className="mt-2 text-sm text-muted">
            房產不納入每日投資報酬；新增股票或基金後即可建立損益日曆。
          </p>
          <Link href="/holdings/new" className="btn-primary mt-5 inline-flex">
            新增投資資產
          </Link>
        </section>
      ) : (
        <section className="glass-card overflow-hidden p-2 sm:p-4">
          {!hasSelectedMonthPrices && calendar.days.length === 0 ? (
            <div className="m-2 rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted">
              這個月份尚無價格歷史。可按「補齊資料」，或保留空白而不把休市日誤算為零。
            </div>
          ) : null}
          <CalendarGrid
            rows={rows}
            calendar={calendar}
            weekendEvents={weekendEvents}
            onSelectDay={(day) => setSelection({ kind: "day", day })}
            onSelectWeek={selectWeek}
          />
        </section>
      )}

      <p className="text-xs leading-5 text-muted">
        已結束日期使用收盤價或基金 NAV；「暫」代表今日即時估值，「估」代表舊資料回算，比例標籤代表只有部分資產更新。無新價格的日期顯示 —。
      </p>

      {selection ? (
        <PnlDetailPanel
          selection={selection}
          transactions={storage.transactions}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {dividendOpen ? (
        <DividendModal
          holdings={investmentHoldings}
          onSave={addDividend}
          onClose={() => setDividendOpen(false)}
        />
      ) : null}
    </div>
  );
}
