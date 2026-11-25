"use client";

import { useMemo, useState } from "react";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatPercent } from "@/lib/portfolio/calculations";
import { groupHoldingsWithMetrics } from "@/lib/portfolio/holding-groups";
import { computeParallelUniverse } from "@/lib/portfolio/parallel-universe";
import { buildInstrumentPriceHistory } from "@/lib/portfolio/price-history";
import type { CorporateActionRecord, HoldingWithMetrics, PriceHistoryMap } from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

export function ParallelUniversePanel({
  holdings,
  priceHistory,
  corporateActions,
  asOfDate,
  view = "standard",
}: {
  holdings: HoldingWithMetrics[];
  priceHistory: PriceHistoryMap;
  corporateActions: CorporateActionRecord[];
  asOfDate?: string;
  view?: DashboardCardView;
}) {
  const { formatAmount } = useAmountPrivacy();
  const options = useMemo(
    () => groupHoldingsWithMetrics(holdings)
      .filter((group) => group.assetType !== "property")
      .map((group) => ({
        ...group,
        ...buildInstrumentPriceHistory(group, priceHistory, corporateActions, asOfDate),
      }))
      .filter((group) => group.points.length >= 2)
      .sort((a, b) => a.symbol.localeCompare(b.symbol, "zh-TW") || a.groupKey.localeCompare(b.groupKey)),
    [holdings, priceHistory, corporateActions, asOfDate]
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState(10_000);
  const [editedStartDate, setEditedStartDate] = useState<string | null>(null);

  const selected = options.find((option) => option.groupKey === selectedKey) ?? options[0];
  const earliestDate = selected?.points[0]?.date ?? "";
  const latestDate = selected?.points.at(-1)?.date ?? "";
  const preferredStart = selected?.groupKey === selectedKey ? editedStartDate : null;
  const startDate = preferredStart && (preferredStart < earliestDate || preferredStart > latestDate)
    ? earliestDate
    : preferredStart ?? earliestDate;

  const result = selected && startDate
    ? computeParallelUniverse(selected.points, { startDate, monthlyAmount })
    : null;
  const rates = result?.strategies.map(({ returnRate }) => Number(returnRate.toFixed(2)));
  const winner = result && rates && rates[0] !== rates[1]
    ? result.strategies[rates[0] > rates[1] ? 0 : 1].id
    : undefined;

  return (
    <article className="universe-tool glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">定期定額平行宇宙</h2>
          <p className="mt-1 text-xs text-muted">用相同本金比較每月定期定額與期初一次投入。</p>
        </div>
        {result && (
          <span className="rounded-full bg-accent-dim px-2.5 py-1 text-xs font-medium text-accent">
            {result.contributionCount} 次投入
          </span>
        )}
      </div>

      {options.length === 0 ? (
        <div className="mt-5 rounded-xl bg-surface-raised p-5 text-center text-sm text-muted">
          股票或基金至少需要兩筆歷史價格，才能開啟平行宇宙。
        </div>
      ) : (
        <>
          <div className="universe-controls mt-5 grid gap-3">
            <label className="text-xs text-muted">
              模擬標的
              <select
                value={selected?.groupKey ?? ""}
                onChange={(event) => {
                  setSelectedKey(event.target.value);
                  setEditedStartDate(null);
                }}
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
              >
                {options.map((option) => (
                  <option key={option.groupKey} value={option.groupKey}>
                    {option.name}（{option.symbol}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              每月投入
              <span className="mt-1 flex rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
                <span className="py-2">NT$</span>
                <input
                  type="number"
                  min={100}
                  step={1000}
                  value={monthlyAmount}
                  onChange={(event) => setMonthlyAmount(Math.max(100, Number(event.target.value) || 100))}
                  className="min-w-0 flex-1 bg-transparent py-2 text-right text-sm font-semibold"
                />
              </span>
            </label>
            <label className="text-xs text-muted">
              開始日期
              <input
                type="date"
                min={earliestDate || undefined}
                max={latestDate || undefined}
                value={startDate}
                onChange={(event) => {
                  setSelectedKey(selected?.groupKey ?? "");
                  setEditedStartDate(event.target.value);
                }}
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>

          {result && selected ? (
            <div className="mt-5">
              <div className="universe-results grid gap-3">
                <section className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-sm font-medium">{asOfDate ? "回看日持有" : "目前實際持有"}</p>
                  <p className="mt-3 text-xl font-bold tabular-nums">{formatAmount(selected.marketValue)}</p>
                  <p className={`mt-1 text-sm font-semibold tabular-nums ${selected.pnl === 0 ? "text-muted" : selected.pnl > 0 ? "text-gain" : "text-loss"}`}>
                    未實現 {formatAmount(selected.pnl)} · {formatPercent(selected.returnRate)}
                  </p>
                  {view !== "compact" && <p className="mt-1 text-xs text-muted">成本 {formatAmount(selected.costBasis)}</p>}
                  <p className="mt-1 text-xs text-muted">依總覽估值 {asOfDate ?? todayIsoDate()}</p>
                </section>
                {result.strategies.map((item) => (
                  <section key={item.id} className={`rounded-2xl border p-4 ${winner === item.id ? "border-accent bg-accent-dim/40" : "border-border bg-surface-raised/50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.label}</p>
                      {winner === item.id && <span className="text-[10px] font-semibold text-accent">本次領先</span>}
                    </div>
                    <p className="mt-3 text-xl font-bold tabular-nums">{formatAmount(item.finalValue)}</p>
                    <p className={`mt-1 text-sm font-semibold tabular-nums ${item.pnl === 0 ? "text-muted" : item.pnl > 0 ? "text-gain" : "text-loss"}`}>
                      {formatAmount(item.pnl)} · {formatPercent(item.returnRate)}
                    </p>
                    {view !== "compact" && <p className="mt-1 text-xs text-muted">投入 {formatAmount(item.invested)}</p>}
                  </section>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                <span>回測 {result.startDate}～{result.endDate}</span>
                {view !== "compact" && <span>期間價格最大回撤 {result.maxDrawdown.toFixed(1)}%</span>}
                <span>模擬未計股息、費用與稅</span>
              </div>
              {selected.lastShareChange && result.startDate < selected.lastShareChange ? (
                <p className="mt-2 text-xs text-muted">股數異動前的價格已換算為查看日期的股數基準。</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-surface-raised p-4 text-sm text-muted">所選日期後的價格資料不足。</p>
          )}
        </>
      )}
    </article>
  );
}
