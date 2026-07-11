"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/portfolio/calculations";
import { getAssetTypeLabel } from "@/lib/portfolio/asset-labels";
import {
  DEFAULT_ALLOCATION_TARGETS,
  computeRebalancePlan,
} from "@/lib/portfolio/rebalance";
import {
  computeStressTest,
  type AssetShockRates,
} from "@/lib/portfolio/stress-test";
import type {
  AssetAllocationTargets,
  AssetType,
  HoldingWithMetrics,
  PortfolioSummary,
} from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";

const ASSET_TYPES: AssetType[] = ["stock", "fund", "property"];

const STRESS_SCENARIOS = {
  correction: {
    label: "市場修正",
    description: "股票 −10%、基金 −5%",
    shocks: { stock: -10, fund: -5, property: 0 },
  },
  crisis: {
    label: "全面風暴",
    description: "股票 −25%、基金 −15%、房子 −10%",
    shocks: { stock: -25, fund: -15, property: -10 },
  },
  largest: {
    label: "單一重挫",
    description: "最大標的 −30%",
    shocks: { stock: 0, fund: 0, property: 0 },
  },
  custom: {
    label: "自訂情境",
    description: "自行調整各類資產",
    shocks: { stock: -10, fund: -10, property: -10 },
  },
} satisfies Record<string, { label: string; description: string; shocks: AssetShockRates }>;

type StressScenarioId = keyof typeof STRESS_SCENARIOS;

export function PortfolioPlanningTools({
  holdings,
  summary,
  savedTargets,
  onSaveTargets,
  readOnly = false,
}: {
  holdings: HoldingWithMetrics[];
  summary: PortfolioSummary;
  savedTargets?: AssetAllocationTargets;
  onSaveTargets: (targets: AssetAllocationTargets) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <StressTestPanel holdings={holdings} />
      <RebalancePanel
        summary={summary}
        savedTargets={savedTargets}
        onSaveTargets={onSaveTargets}
        readOnly={readOnly}
      />
    </section>
  );
}

export function StressTestPanel({ holdings, view = "standard" }: { holdings: HoldingWithMetrics[]; view?: DashboardCardView }) {
  const [scenarioId, setScenarioId] = useState<StressScenarioId>("correction");
  const [customShocks, setCustomShocks] = useState<AssetShockRates>(STRESS_SCENARIOS.custom.shocks);
  const scenario = STRESS_SCENARIOS[scenarioId];
  const shocks = scenarioId === "custom" ? customShocks : scenario.shocks;
  const result = useMemo(
    () => computeStressTest(holdings, shocks, scenarioId === "largest" ? { largestHoldingShock: -30 } : undefined),
    [holdings, scenarioId, shocks]
  );

  return (
    <article className="planning-tool glass-card p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-muted">情境模擬</p>
        <h2 className="mt-1 text-xl font-semibold">資產壓力測試</h2>
        <p className="mt-1 text-xs text-muted">只做假設試算，不會更動持倉或行情。</p>
      </div>

      <div className="stress-scenario-grid mt-5 grid gap-2">
        {(Object.keys(STRESS_SCENARIOS) as StressScenarioId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setScenarioId(id)}
            className={`rounded-xl border px-3 py-2 text-left transition ${scenarioId === id ? "border-accent bg-accent-dim text-accent" : "border-border bg-surface hover:border-accent/50"}`}
          >
            <span className="block text-sm font-medium">{STRESS_SCENARIOS[id].label}</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted">{STRESS_SCENARIOS[id].description}</span>
          </button>
        ))}
      </div>

      {scenarioId === "custom" && (
        <div className="stress-custom-grid mt-4 grid gap-3 rounded-xl bg-surface-raised/70 p-3">
          {ASSET_TYPES.map((assetType) => (
            <label key={assetType} className="text-xs">
              <span className="flex justify-between gap-2"><span>{getAssetTypeLabel(assetType)}</span><span className="tabular-nums text-muted">{customShocks[assetType]}%</span></span>
              <input
                type="range"
                min={-50}
                max={20}
                step={1}
                value={customShocks[assetType]}
                onChange={(event) => setCustomShocks((current) => ({ ...current, [assetType]: Number(event.target.value) }))}
                className="mt-2 block w-full cursor-pointer accent-[var(--accent)]"
              />
            </label>
          ))}
        </div>
      )}

      <div className="mt-5 rounded-2xl bg-rose-500/10 p-4">
        <p className="text-xs text-muted">情境後預估總資產</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">{formatCurrency(result.stressedValue)}</span>
          <span className="font-semibold tabular-nums text-loss">{result.impactRate.toFixed(1)}% · {formatCurrency(result.impact)}</span>
        </div>
        {result.shockedHoldingName && <p className="mt-1 text-xs text-muted">假設「{result.shockedHoldingName}」單一標的下跌 30%</p>}
      </div>

      <div className={`mt-4 space-y-3 ${view === "compact" ? "hidden" : ""}`}>
        {result.rows.filter((row) => row.currentValue > 0).map((row) => (
          <div key={row.assetType} className="flex items-center justify-between gap-4 text-sm">
            <div>
              <span className="font-medium">{getAssetTypeLabel(row.assetType)}</span>
              <span className="ml-2 text-xs text-muted">情境 {row.shockRate > 0 ? "+" : ""}{row.shockRate}%</span>
            </div>
            <span className={`tabular-nums ${row.impact < 0 ? "text-loss" : row.impact > 0 ? "text-gain" : "text-muted"}`}>
              {row.impact > 0 ? "+" : ""}{formatCurrency(row.impact)}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function RebalancePanel({
  summary,
  savedTargets,
  onSaveTargets,
  readOnly,
  view = "standard",
}: {
  summary: PortfolioSummary;
  savedTargets?: AssetAllocationTargets;
  onSaveTargets: (targets: AssetAllocationTargets) => void;
  readOnly: boolean;
  view?: DashboardCardView;
}) {
  const [targets, setTargets] = useState<AssetAllocationTargets>(savedTargets ?? DEFAULT_ALLOCATION_TARGETS);
  const [cash, setCash] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (savedTargets) setTargets(savedTargets);
  }, [savedTargets]);

  const plan = computeRebalancePlan(summary, targets, cash);

  function changeTarget(assetType: AssetType, value: number) {
    setSaved(false);
    setTargets((current) => ({ ...current, [assetType]: Math.min(100, Math.max(0, value || 0)) }));
  }

  return (
    <article className="planning-tool glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">配置規劃</p>
          <h2 className="mt-1 text-xl font-semibold">再平衡導航</h2>
          <p className="mt-1 text-xs text-muted">計算增減金額，不會替你下單。</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${plan.valid ? "bg-emerald-500/10 text-gain" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
          目標合計 {plan.targetTotal.toFixed(0)}%
        </span>
      </div>

      <div className="rebalance-target-grid mt-5 grid gap-3">
        {ASSET_TYPES.map((assetType) => (
          <label key={assetType} className="text-xs text-muted">
            {getAssetTypeLabel(assetType)}目標
            <span className="mt-1 flex items-center rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={targets[assetType]}
                onChange={(event) => changeTarget(assetType, Number(event.target.value))}
                className="min-w-0 flex-1 bg-transparent py-2 text-right font-semibold text-foreground"
              />
              <span className="ml-1">%</span>
            </span>
          </label>
        ))}
      </div>

      <label className="mt-4 block text-xs text-muted">
        預計投入的新資金（選填）
        <span className="mt-1 flex items-center rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
          <span>NT$</span>
          <input
            type="number"
            min={0}
            step={1000}
            value={cash || ""}
            placeholder="0"
            onChange={(event) => setCash(Math.max(0, Number(event.target.value) || 0))}
            className="min-w-0 flex-1 bg-transparent py-2 text-right font-semibold text-foreground"
          />
        </span>
      </label>

      {!plan.valid ? (
        <div className="mt-5 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">三類資產的目標必須合計為 100%，才能產生導航。</div>
      ) : summary.totalValue <= 0 ? (
        <div className="mt-5 rounded-xl bg-surface-raised p-3 text-sm text-muted">新增持倉後即可計算再平衡金額。</div>
      ) : (
        <div className="mt-5 space-y-3">
          {plan.actions.map((action) => {
            const nearTarget = Math.abs(action.adjustment) < Math.max(100, plan.plannedTotalValue * 0.002);
            const verb = nearTarget ? "維持" : action.adjustment > 0 ? "增持" : "減持";
            return (
              <div key={action.assetType} className="rounded-xl bg-surface-raised/70 p-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{getAssetTypeLabel(action.assetType)}</p>
                    {view !== "compact" && <p className="mt-0.5 text-xs text-muted">目前 {action.currentPercent.toFixed(1)}% → 目標 {action.targetPercent.toFixed(0)}%</p>}
                  </div>
                  <div className="text-right">
                    <p className={`text-xs ${nearTarget ? "text-muted" : action.adjustment > 0 ? "text-gain" : "text-loss"}`}>{verb}</p>
                    <p className="font-semibold tabular-nums">{nearTarget ? "—" : formatCurrency(Math.abs(action.adjustment))}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-muted">房子等不易切分的資產，金額僅作配置差距參考。</p>
        <button
          type="button"
          disabled={!plan.valid || readOnly}
          onClick={() => { onSaveTargets(targets); setSaved(true); }}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          title={readOnly ? "時間旅行模式下不可修改設定" : undefined}
        >
          {saved ? "已儲存" : "儲存目標"}
        </button>
      </div>
    </article>
  );
}
