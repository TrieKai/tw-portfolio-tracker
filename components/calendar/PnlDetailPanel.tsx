"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatQuotePrice } from "@/lib/portfolio/calculations";
import { formatFinancingCostImpact } from "@/lib/loans/format";
import { formatIsoDateZh } from "@/lib/date/iso-date";
import type {
  PnlCalendarDay,
  PnlCalendarWeek,
} from "@/lib/portfolio/pnl-calendar";
import type { PortfolioTransaction } from "@/lib/types/holding";

export type PnlDetailSelection =
  | { kind: "day"; day: PnlCalendarDay }
  | { kind: "week"; week: PnlCalendarWeek; days: PnlCalendarDay[] };

function pnlClass(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted";
}

function signedCurrency(value: number): string {
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function signedRate(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function qualityLabel(day: PnlCalendarDay): string {
  if (day.isProvisional) return "今日暫估";
  if (day.quality === "estimated") return "舊資料估算";
  if (day.quality === "partial") {
    return `部分資料 · ${day.pricedHoldingCount}/${day.totalHoldingCount} 項更新`;
  }
  return "完整資料";
}

function DayDetail({
  day,
  transactions,
  showSummary = true,
}: {
  day: PnlCalendarDay;
  transactions: PortfolioTransaction[];
  showSummary?: boolean;
}) {
  return (
    <section className="space-y-4">
      {showSummary ? (
        <div className="rounded-xl border border-border bg-surface-raised/60 p-4">
          <p className="text-xs text-muted">{qualityLabel(day)}</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <p className={`text-2xl font-semibold tabular-nums ${pnlClass(day.pnl)}`}>
              {signedCurrency(day.pnl)}
            </p>
            <p className={`font-medium tabular-nums ${pnlClass(day.returnRate)}`}>
              {signedRate(day.returnRate)}
            </p>
          </div>
          {day.financingCost && Math.abs(day.financingCost) > 1e-9 ? (
            <p className="mt-2 text-xs text-muted">
              投資損益 {signedCurrency(day.grossPnl ?? day.pnl)} · 融資成本影響 {formatFinancingCostImpact(day.financingCost)}
            </p>
          ) : null}
        </div>
      ) : null}

      {day.contributions.length === 0 ? (
        <p className="rounded-xl border border-border p-4 text-sm text-muted">
          {day.financingCost && Math.abs(day.financingCost) > 1e-9
            ? `這一天只有融資成本調整 ${formatFinancingCostImpact(day.financingCost)}。`
            : "這一天只有已保存的總額，逐資產明細已超過保存期限。"}
        </p>
      ) : (
        <div className="space-y-3">
          {day.contributions.map((contribution) => {
            const dividendEvents = transactions.filter(
              (transaction) =>
                contribution.holdingIds.includes(transaction.holdingId) &&
                transaction.type === "cash_dividend" &&
                transaction.date === day.date
            );
            return (
              <article
                key={`${contribution.assetType}:${contribution.market ?? ""}:${contribution.symbol}`}
                className="rounded-xl border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{contribution.name}</h3>
                    <p className="text-xs text-muted">
                      {contribution.symbol}
                      {contribution.holdingIds.length > 1
                        ? ` · ${contribution.holdingIds.length} 筆持倉合併`
                        : ""}
                    </p>
                  </div>
                  <p className={`shrink-0 font-semibold tabular-nums ${pnlClass(contribution.pnl)}`}>
                    {signedCurrency(contribution.pnl)}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">價格變動</dt>
                    <dd className={`mt-0.5 tabular-nums ${pnlClass(contribution.marketPnl)}`}>
                      {signedCurrency(contribution.marketPnl)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">賣出日歸因</dt>
                    <dd className={`mt-0.5 tabular-nums ${pnlClass(contribution.tradePnl)}`}>
                      {signedCurrency(contribution.tradePnl)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">股利／配息</dt>
                    <dd className={`mt-0.5 tabular-nums ${pnlClass(contribution.dividend)}`}>
                      {signedCurrency(contribution.dividend)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">費用與稅</dt>
                    <dd className="mt-0.5 tabular-nums text-loss">
                      {contribution.fee + contribution.tax > 0
                        ? `−${formatCurrency(contribution.fee + contribution.tax)}`
                        : formatCurrency(0)}
                    </dd>
                  </div>
                </dl>

                {contribution.previousPrice !== undefined &&
                contribution.currentPrice !== undefined ? (
                  <p className="mt-3 border-t border-border/70 pt-3 text-xs text-muted">
                    {formatQuotePrice(contribution.previousPrice, contribution.assetType)}
                    {" → "}
                    {formatQuotePrice(contribution.currentPrice, contribution.assetType)}
                  </p>
                ) : null}

                {dividendEvents.map((event) => (
                  <p key={event.id} className="mt-2 text-xs text-muted">
                    除息日 {event.date}
                    {event.settlementDate
                      ? ` · 實際入帳 ${event.settlementDate}`
                      : " · 未填實際入帳日"}
                  </p>
                ))}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function PnlWeekDetail({
  week,
  days,
  transactions,
}: {
  week: PnlCalendarWeek;
  days: PnlCalendarDay[];
  transactions: PortfolioTransaction[];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface-raised/60 p-4">
        <p className="text-xs text-muted">本週總結</p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted">總損益</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${pnlClass(week.pnl)}`}>
              {signedCurrency(week.pnl)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">複利報酬</p>
            <p className={`mt-1 font-medium tabular-nums ${pnlClass(week.returnRate)}`}>
              {signedRate(week.returnRate)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{week.dataDayCount} 個損益日</p>
        {week.financingCost && Math.abs(week.financingCost) > 1e-9 ? (
          <p className="mt-1 text-xs text-muted">
            投資損益 {signedCurrency(week.grossPnl ?? week.pnl)} · 融資成本影響 {formatFinancingCostImpact(week.financingCost)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {days.map((day) => (
          <details
            key={day.date}
            className="group rounded-xl border border-border bg-surface"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{formatIsoDateZh(day.date)}</h3>
                <p className="mt-0.5 text-xs text-muted">{qualityLabel(day)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                <div>
                  <p className={`font-semibold tabular-nums ${pnlClass(day.pnl)}`}>
                    {signedCurrency(day.pnl)}
                  </p>
                  <p className={`text-xs tabular-nums ${pnlClass(day.returnRate)}`}>
                    {signedRate(day.returnRate)}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </div>
            </summary>
            <div className="border-t border-border px-4 py-4">
              <DayDetail
                day={day}
                transactions={transactions}
                showSummary={false}
              />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export function PnlDetailPanel({
  selection,
  transactions,
  onClose,
}: {
  selection: PnlDetailSelection;
  transactions: PortfolioTransaction[];
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const isDay = selection.kind === "day";
  const title = isDay
    ? formatIsoDateZh(selection.day.date)
    : `${selection.week.startDate.slice(5).replace("-", "/")}–${selection.week.endDate.slice(5).replace("-", "/")} 週損益`;

  useEffect(() => {
    setPortalRoot(document.body);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!portalRoot) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] w-screen items-end bg-black/60 sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pnl-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:h-[100dvh] sm:max-w-md sm:rounded-none sm:border-l sm:border-border"
      >
        <div className="sticky top-0 z-20 flex items-center justify-between gap-4 rounded-t-2xl border-b border-border bg-surface px-5 py-4 sm:rounded-none sm:px-6">
          <div>
            <p className="text-xs text-muted">損益明細</p>
            <h2 id="pnl-detail-title" className="mt-1 text-lg font-semibold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-lg text-xl text-muted hover:bg-surface-raised hover:text-foreground"
            aria-label="關閉明細"
          >
            ×
          </button>
        </div>

        <div
          className="px-5 pt-5 sm:px-6"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          {selection.kind === "day" ? (
            <DayDetail day={selection.day} transactions={transactions} />
          ) : selection.days.length === 0 ? (
            <p className="rounded-xl border border-border p-5 text-sm text-muted">
              這一週尚無可計算的估值資料。
            </p>
          ) : (
            <PnlWeekDetail
              week={selection.week}
              days={selection.days}
              transactions={transactions}
            />
          )}
        </div>
      </aside>
    </div>,
    portalRoot
  );
}
