"use client";

import Link from "next/link";
import {
  useCallback,
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
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  addDaysToIsoDate,
  currentYearMonthPrefix,
  endOfMonthIsoFromPrefix,
  formatYearMonthZh,
  parseIsoDate,
  todayIsoDate,
  toIsoDate,
} from "@/lib/date/iso-date";
import {
  buildTradingCalendarGrid,
  type TradingCalendarRow,
} from "@/lib/date/trading-calendar";
import { canImportHistory } from "@/lib/client/holding-history";
import { MAX_PRICE_HISTORY_DAYS } from "@/lib/portfolio/constants";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { formatFinancingCostImpact } from "@/lib/loans/format";
import {
  buildPnlCalendar,
  type PnlCalendarDay,
  type PnlCalendarFilter,
  type PnlCalendarResult,
  type PnlCalendarWeek,
} from "@/lib/portfolio/pnl-calendar";
import { usePortfolio } from "@/providers/PortfolioProvider";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五"] as const;

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const next = new Date(year, monthNumber - 1 + amount, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
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

function pnlClass(value: number | null): string {
  if (value === null) return "text-muted";
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted";
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate > 0 ? "+" : ""}${rate.toFixed(2)}%`;
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
  if (day.saleWithoutPriorPrice) return "缺前收";
  if (day.gapStartDate) return "區間";
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
  const { amountsHidden, maskAmount, formatSignedAmount } = useAmountPrivacy();
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
      style={day && !amountsHidden ? heatStyle(day, maximum) : undefined}
      aria-label={
        day
          ? `${date}，損益 ${amountsHidden ? "金額已隱藏" : formatSignedAmount(day.pnl)}，報酬 ${day.returnRate === null ? "無可用基準" : formatRate(day.returnRate)}${day.gapStartDate ? `，自 ${day.gapStartDate} 的區間價差` : ""}${day.saleWithoutPriorPrice ? "，賣出缺少前收，按可確認的成交損益列示" : ""}`
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
            {maskAmount(compactPnl(day.pnl))}
          </span>
          <span className="mt-1 hidden text-center text-sm tabular-nums text-foreground md:block">
            {formatRate(day.returnRate)}
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

export function CalendarGrid({
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
  const { maskAmount } = useAmountPrivacy();
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
            <button
              type="button"
              disabled={!week && weekendEventCount === 0}
              onClick={() => selectableWeek && onSelectWeek(selectableWeek)}
              className="order-first col-span-5 flex min-h-12 items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-left disabled:cursor-default md:order-last md:col-span-1 md:min-h-28 md:flex-col md:items-stretch md:justify-center md:text-center"
              aria-label={`第 ${index + 1} 週損益`}
            >
              <span className="text-xs text-muted md:mb-2">第 {index + 1} 週</span>
              <span className={`font-semibold tabular-nums ${week ? pnlClass(week.pnl) : "text-muted"}`}>
                {week ? maskAmount(compactPnl(week.pnl)) : "—"}
              </span>
              {week ? (
                <span className={`hidden text-xs tabular-nums md:block ${pnlClass(week.returnRate)}`}>
                  {formatRate(week.returnRate)}{week.returnRateIncomplete && week.returnRate !== null ? " 估" : ""}
                </span>
              ) : null}
              {weekendEventCount > 0 ? (
                <span className="text-[10px] text-amber-600 dark:text-amber-300">
                  {weekendEventCount} 筆非交易日事件
                </span>
              ) : null}
            </button>
            {row.dates.map((date, dayIndex) => (
              <CalendarDayCell
                key={date ?? `${row.weekStartDate}-${dayIndex}`}
                date={date}
                day={date ? dayByDate.get(date) : undefined}
                maximum={maximum}
                onSelect={onSelectDay}
              />
            ))}
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
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums sm:text-2xl ${className}`}>
        {value}
      </p>
      {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
    </div>
  );
}

export function calendarHistoryRange(month: string, today: string) {
  const monthEnd = endOfMonthIsoFromPrefix(month);
  // 保留上月底的估值基準，首個交易日也能計算日損益。
  const previousMonth = shiftMonth(month, -1);
  const earliest = addDaysToIsoDate(today, -MAX_PRICE_HISTORY_DAYS);
  const startDate = `${previousMonth}-01`;
  return {
    startDate: startDate < earliest ? earliest : startDate,
    endDate: monthEnd < today ? monthEnd : today,
  };
}

export function PnlCalendarPage() {
  const {
    ready,
    holdings,
    storage,
    addDividend,
    refreshPortfolioForRange,
    batchStatus,
  } = usePortfolio();
  const currentMonth = currentYearMonthPrefix();
  const today = todayIsoDate();
  const { maskAmount, formatSignedAmount } = useAmountPrivacy();
  const [month, setMonth] = useState(currentMonth);
  const [filterValue, setFilterValue] = useState("investment");
  const [performanceView, setPerformanceView] = useState<"gross" | "net">("gross");
  const [selection, setSelection] = useState<PnlDetailSelection | null>(null);
  const [dividendOpen, setDividendOpen] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<{ month: string; text: string; error: boolean } | null>(null);
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const autoLoadedRef = useRef(new Set<string>());
  const closeDetail = useCallback(() => setSelection(null), []);

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
    for (const record of [...storage.transactions, ...storage.sales]) {
      if (record.assetType !== "property" && !options.has(record.holdingId)) {
        options.set(record.holdingId, {
          id: record.holdingId,
          name: record.name,
          symbol: record.symbol,
        });
      }
    }
    return Array.from(options.values());
  }, [investmentHoldings, storage.transactions, storage.sales]);
  const filter = useMemo(() => filterFromValue(filterValue), [filterValue]);
  const showNetPerformance = performanceView === "net" && filter.kind === "investment";
  const calendar = useMemo(
    () =>
      buildPnlCalendar(storage, {
        month,
        asOfDate: today,
        filter,
        includeFinancingCosts: showNetPerformance,
      }),
    [storage, month, today, filter, showNetPerformance]
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
    for (const day of calendar.days) {
      if (!day.financingCost || Math.abs(day.financingCost) <= 1e-9) continue;
      const date = parseIsoDate(day.date);
      if (!date || (date.getDay() !== 0 && date.getDay() !== 6)) continue;
      const weekStart = weekStartForDate(day.date);
      counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
    }
    return counts;
  }, [calendar.days, storage.transactions, month]);

  const historyRange = useMemo(() => calendarHistoryRange(month, today), [month, today]);
  const hasHoldingsForMonth = investmentHoldings.some((holding) => holding.buyDate <= historyRange.endDate);
  const canBackfill = investmentHoldings.some((holding) =>
    holding.buyDate <= historyRange.endDate && canImportHistory(holding)
  ) && historyRange.startDate <= historyRange.endDate;
  const batchPending = batchStatus === "loading";
  const loadMonthHistory = useCallback(async () => {
    setLoadingMonth(month);
    setHistoryNotice(null);
    const result = await refreshPortfolioForRange(historyRange);
    setLoadingMonth(null);
    setHistoryNotice({
      month,
      error: !result.ok,
      text: (result.ok ? result.message : result.error) ?? "無法載入所選月份的價格",
    });
  }, [historyRange, month, refreshPortfolioForRange]);

  useEffect(() => {
    if (!ready || month !== currentMonth || hasSelectedMonthPrices || !canBackfill || batchPending) return;
    if (autoLoadedRef.current.has(month)) return;
    autoLoadedRef.current.add(month);
    void loadMonthHistory();
  }, [batchPending, canBackfill, currentMonth, hasSelectedMonthPrices, loadMonthHistory, month, ready]);

  if (!ready) return <LoadingSpinner />;

  if (filterHoldings.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="損益日曆" description="查看每日投資損益，也可切換至扣息後績效。" />
        <EmptyState
          title="尚無股票或基金"
          description="新增股票或基金後，即可在日曆查看每日投資損益。"
          action={<Link href="/holdings/new" className="btn-primary">新增投資資產</Link>}
        />
      </div>
    );
  }

  const hasValuations = calendar.summary.dataDayCount > 0;
  const completeness = hasValuations
    ? (calendar.summary.completeDayCount / calendar.summary.dataDayCount) * 100
    : 0;
  const isEstimatedMonth = hasValuations &&
    (!storage.pnlTracking.startedAt || month < storage.pnlTracking.startedAt.slice(0, 7));

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
        description="查看每日投資損益，也可切換至扣息後績效。"
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
              onClick={() => void loadMonthHistory()}
              disabled={batchPending || loadingMonth !== null || !canBackfill}
              className="btn-primary flex-1 sm:flex-none"
            >
              {loadingMonth === month ? "載入中…" : "補齊所選月份"}
            </button>
          </div>
        }
      />

      <section className="glass-card space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold tabular-nums">{formatYearMonthZh(month)}</h2>
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
            {month !== currentMonth && (
              <button
                type="button"
                onClick={() => chooseMonth(currentMonth)}
                className="btn-secondary col-span-3 sm:col-auto"
              >
                回到本月
              </button>
            )}
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

        {filter.kind === "investment" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-xs" role="group" aria-label="損益口徑">
            <button type="button" onClick={() => setPerformanceView("gross")} aria-pressed={performanceView === "gross"} className={performanceView === "gross" ? "btn-primary" : "btn-secondary"}>投資損益</button>
            <button type="button" onClick={() => setPerformanceView("net")} aria-pressed={performanceView === "net"} className={performanceView === "net" ? "btn-primary" : "btn-secondary"}>扣息後</button>
          </div>
        ) : null}

        {isEstimatedMonth ? (
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            這個月份早於完整追蹤起點，數字僅依目前仍可重建的持倉估算；已結清舊部位不會捏造日損益。
          </p>
        ) : null}
        {historyNotice?.month === month && (
          <p role="status" className={`text-sm ${historyNotice.error ? "text-rose-700 dark:text-rose-300" : "text-muted"}`}>
            {historyNotice.text}
          </p>
        )}
      </section>

      {hasValuations ? (
        <section className="metric-grid-container" aria-label="所選月份損益摘要">
          <div className="metric-grid">
            <SummaryCard
              label={showNetPerformance ? "扣息後淨損益" : "投資損益"}
              value={formatSignedAmount(calendar.summary.pnl)}
              className={pnlClass(calendar.summary.pnl)}
              description={showNetPerformance ? `投資損益 ${formatSignedAmount(calendar.summary.grossPnl ?? calendar.summary.pnl)}` : undefined}
            />
            <SummaryCard
              label={showNetPerformance ? "估算淨報酬率" : "複利報酬率"}
              value={formatRate(calendar.summary.returnRate)}
              description={calendar.summary.returnRateIncomplete ? "部分日期缺少報酬基準" : undefined}
              className={pnlClass(calendar.summary.returnRate)}
            />
            <SummaryCard
              label={showNetPerformance ? "融資成本影響" : "獲利／虧損日"}
              value={showNetPerformance
                ? maskAmount(formatFinancingCostImpact(calendar.summary.financingCost ?? 0))
                : `${calendar.summary.gainDayCount}／${calendar.summary.lossDayCount}`}
              className={showNetPerformance ? "text-loss" : undefined}
              description={showNetPerformance ? "依貸款本金、利息與繳款紀錄計算" : `共 ${calendar.summary.dataDayCount} 個估值日`}
            />
            <SummaryCard
              label="估值日完整度"
              value={`${completeness.toFixed(0)}%`}
              description={`${calendar.summary.completeDayCount}／${calendar.summary.dataDayCount} 日完整`}
            />
          </div>
        </section>
      ) : (
        <EmptyState
          title={loadingMonth === month ? "正在載入所選月份的資料" : "所選範圍尚無損益資料"}
          description={canBackfill
            ? "可補齊所選月份和上月底的估值價格，再查看日、週與月損益。"
            : hasHoldingsForMonth
              ? "可在持倉頁手動補入價格。自動歷史查詢支援上市股票和境內基金，價格保留近三年。"
              : "所選月份沒有可自動補齊的現有持倉，可切換月份查看其他紀錄。"}
        />
      )}

      <section className="glass-card p-2 sm:p-4" aria-label="交易週日曆">
        <CalendarGrid
          rows={rows}
          calendar={calendar}
          weekendEvents={weekendEvents}
          onSelectDay={(day) => setSelection({ kind: "day", day })}
          onSelectWeek={selectWeek}
        />
      </section>

      <p className="text-xs leading-5 text-muted">
        已結束日期使用收盤價或基金 NAV；「暫」代表今日即時估值，「估」包含舊資料回算或融資成本估算，「區間」表示自買入日至首次估值，或中間有平日缺少估值，「缺前收」表示賣出僅能列示已確認的成交損益，比例標籤代表只有部分資產更新。非交易日的利息會計入週與月合計。
      </p>

      {selection ? (
        <PnlDetailPanel
          selection={selection}
          transactions={storage.transactions}
          onClose={closeDetail}
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
