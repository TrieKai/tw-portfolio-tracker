"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatCurrency,
  formatPercent,
  getMergedSortedHistory,
} from "@/lib/portfolio/calculations";
import { groupHoldings } from "@/lib/portfolio/holding-groups";
import { computeParallelUniverse } from "@/lib/portfolio/parallel-universe";
import type { Holding, PriceHistoryMap } from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";

export function ParallelUniversePanel({
  holdings,
  priceHistory,
  view = "standard",
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  view?: DashboardCardView;
}) {
  const options = useMemo(
    () => groupHoldings(holdings)
      .filter((group) => group.assetType !== "property")
      .map((group) => ({
        ...group,
        points: getMergedSortedHistory(priceHistory, group.lots.map((lot) => lot.id)),
      }))
      .filter((group) => group.points.length >= 2),
    [holdings, priceHistory]
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState(10_000);
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    if (!options.some((option) => option.groupKey === selectedKey)) {
      setSelectedKey(options[0]?.groupKey ?? "");
    }
  }, [options, selectedKey]);

  const selected = options.find((option) => option.groupKey === selectedKey);
  useEffect(() => {
    setStartDate(selected?.points[0]?.date ?? "");
  }, [selectedKey, selected]);

  const result = selected && startDate
    ? computeParallelUniverse(selected.points, {
        startDate,
        monthlyAmount,
        actualCost: selected.lots.reduce((sum, lot) => sum + lot.buyPrice * lot.quantity, 0),
        actualQuantity: selected.lots.reduce((sum, lot) => sum + lot.quantity, 0),
      })
    : null;
  const winner = result
    ? [...result.strategies].sort((a, b) => b.returnRate - a.returnRate)[0]?.id
    : null;

  return (
    <article className="universe-tool glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">策略回測</p>
          <h2 className="mt-1 text-xl font-semibold">定期定額平行宇宙</h2>
          <p className="mt-1 text-xs text-muted">如果同一段時間採用不同投入方式，結果會差多少？</p>
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
                value={selectedKey}
                onChange={(event) => setSelectedKey(event.target.value)}
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
                min={selected?.points[0]?.date}
                max={selected
                  ? selected.points[selected.points.length - 1]?.date
                  : undefined}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>

          {result ? (
            <div className="mt-5">
              <div className="universe-results grid gap-3">
                {result.strategies.map((item) => (
                  <section key={item.id} className={`rounded-2xl border p-4 ${winner === item.id ? "border-accent bg-accent-dim/40" : "border-border bg-surface-raised/50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.label}</p>
                      {winner === item.id && <span className="text-[10px] font-semibold text-accent">本次領先</span>}
                    </div>
                    <p className="mt-3 text-xl font-bold tabular-nums">{formatCurrency(item.finalValue)}</p>
                    <p className={`mt-1 text-sm font-semibold tabular-nums ${item.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {formatCurrency(item.pnl)} · {formatPercent(item.returnRate)}
                    </p>
                    {view !== "compact" && <p className="mt-1 text-xs text-muted">投入 {formatCurrency(item.invested)}</p>}
                  </section>
                ))}
              </div>
              {view !== "compact" && (
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span>{result.startDate} → {result.endDate}</span>
                  <span>期間價格最大回撤 {result.maxDrawdown.toFixed(1)}%</span>
                  <span>未計股息、費用與稅</span>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-surface-raised p-4 text-sm text-muted">所選日期後的價格資料不足。</p>
          )}
        </>
      )}
    </article>
  );
}
