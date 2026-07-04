"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import {
  formatExposureRatio,
  type PortfolioExposureSummary,
} from "@/lib/portfolio/exposure";
import { getAssetTypeLabel } from "@/lib/portfolio/asset-labels";
import type { PortfolioSettings } from "@/lib/types/holding";

interface ExposurePanelProps {
  exposure: PortfolioExposureSummary;
  settings: PortfolioSettings;
  onSaveSettings: (
    patch: Pick<PortfolioSettings, "netAssets" | "liabilities">
  ) => void;
}

export function ExposurePanel({
  exposure,
  settings,
  onSaveSettings,
}: ExposurePanelProps) {
  const [netAssetsInput, setNetAssetsInput] = useState(
    settings.netAssets !== undefined ? String(settings.netAssets) : ""
  );
  const [liabilitiesInput, setLiabilitiesInput] = useState(
    settings.liabilities !== undefined ? String(settings.liabilities) : ""
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setNetAssetsInput(
        settings.netAssets !== undefined ? String(settings.netAssets) : ""
      );
      setLiabilitiesInput(
        settings.liabilities !== undefined ? String(settings.liabilities) : ""
      );
    }
  }, [settings.netAssets, settings.liabilities, editing]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const patch: Pick<PortfolioSettings, "netAssets" | "liabilities"> = {};

    const netRaw = netAssetsInput.trim();
    if (netRaw === "") {
      patch.netAssets = undefined;
    } else {
      const n = Number.parseFloat(netRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) return;
      patch.netAssets = n;
    }

    const liabRaw = liabilitiesInput.trim();
    if (liabRaw === "") {
      patch.liabilities = undefined;
    } else {
      const n = Number.parseFloat(liabRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) return;
      patch.liabilities = n;
    }

    onSaveSettings(patch);
    setEditing(false);
  }

  if (exposure.rows.length === 0) {
    return (
      <div className="glass-card flex h-48 items-center justify-center p-5 text-sm text-muted">
        尚無持倉，無法計算曝險
      </div>
    );
  }

  const netAssetsHint = exposure.usesNetAssetsOverride
    ? "已指定淨資產"
    : exposure.liabilities > 0
      ? `持倉市值 − 負債 ${formatCurrency(exposure.liabilities)}`
      : "未設定時以持倉市值為淨資產";

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">曝險分析</h2>
          <p className="mt-1 text-sm text-muted">
            曝險金額 = 市值 × 槓桿倍數；曝險比例 = 總曝險 ÷ 淨資產
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "取消" : "設定淨資產"}
        </button>
      </div>

      {editing && (
        <form
          onSubmit={handleSubmit}
          className="glass-card space-y-4 p-4 sm:p-5"
        >
          <p className="text-sm text-muted">
            例：自有資金 200 萬、信貸 100 萬、持倉市值 300 萬 → 可填淨資產
            200 萬，或僅填負債 100 萬由系統推算。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">淨資產／自有資金（元）</span>
              <input
                type="text"
                inputMode="decimal"
                className="input-field mt-1 w-full"
                placeholder="留空則由市值 − 負債推算"
                value={netAssetsInput}
                onChange={(e) => setNetAssetsInput(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">投資負債／信貸（元）</span>
              <input
                type="text"
                inputMode="decimal"
                className="input-field mt-1 w-full"
                placeholder="例：1000000"
                value={liabilitiesInput}
                onChange={(e) => setLiabilitiesInput(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="btn-primary text-sm">
            儲存
          </button>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="持倉市值"
          value={formatCurrency(exposure.totalMarketValue)}
        />
        <MetricCard
          label="總曝險金額"
          value={formatCurrency(exposure.totalExposure)}
          sub="Σ（市值 × 槓桿）"
        />
        <MetricCard
          label="淨資產"
          value={formatCurrency(exposure.netAssets)}
          sub={netAssetsHint}
        />
        <MetricCard
          label="曝險比例"
          value={formatExposureRatio(exposure.exposureRatioPct)}
          sub={
            exposure.exposureRatioPct !== null
              ? "總曝險 ÷ 淨資產"
              : "請設定淨資產"
          }
          highlight={
            exposure.exposureRatioPct !== null &&
            exposure.exposureRatioPct > 100
              ? "warn"
              : undefined
          }
        />
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-muted">
              <th className="px-4 py-3 font-medium">標的</th>
              <th className="px-4 py-3 font-medium">類型</th>
              <th className="px-4 py-3 text-right font-medium">市值</th>
              <th className="px-4 py-3 text-right font-medium">槓桿</th>
              <th className="px-4 py-3 text-right font-medium">曝險金額</th>
              <th className="px-4 py-3 text-right font-medium">佔總曝險</th>
            </tr>
          </thead>
          <tbody>
            {exposure.rows.map((row) => (
              <tr
                key={row.groupKey}
                className="border-b border-border/40 last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted">{row.symbol}</div>
                </td>
                <td className="px-4 py-3 text-muted">
                  {getAssetTypeLabel(row.assetType)}
                  {row.isInverse && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      反向
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(row.marketValue)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.leverage === 1 ? "1×" : `${row.leverage}×`}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatCurrency(row.exposureAmount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">
                  {formatPercent(row.exposureSharePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "warn";
}) {
  return (
    <div className="glass-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          highlight === "warn"
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
