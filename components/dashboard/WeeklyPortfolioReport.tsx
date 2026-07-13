import { formatIsoDateZh } from "@/lib/date/iso-date";
import { formatCurrency } from "@/lib/portfolio/calculations";
import { getAssetTypeLabel } from "@/lib/portfolio/asset-labels";
import { buildWeeklyPortfolioReport } from "@/lib/portfolio/weekly-report";
import type {
  AssetAllocationTargets,
  Holding,
  PriceHistoryMap,
  SaleTransaction,
} from "@/lib/types/holding";
import type { DashboardCardView } from "@/lib/types/ui-preferences";

export function WeeklyPortfolioReport({
  holdings,
  priceHistory,
  sales,
  asOfDate,
  targets,
  view = "standard",
}: {
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  sales: SaleTransaction[];
  asOfDate: string;
  targets?: AssetAllocationTargets;
  view?: DashboardCardView;
}) {
  const report = buildWeeklyPortfolioReport(
    holdings,
    priceHistory,
    sales,
    asOfDate,
    targets
  );

  if (!report) {
    return (
      <article className="glass-card p-5 sm:p-6">
        <p className="text-sm font-medium text-muted">每週投資週報</p>
        <h2 className="mt-1 text-xl font-semibold">本週尚無足夠資料</h2>
        <p className="mt-3 text-sm text-muted">累積至少兩個有效行情日後，就會自動整理市場變化與重要提醒。</p>
      </article>
    );
  }

  const marketPositive = report.unrealizedChange >= 0;
  const period = `${formatIsoDateZh(report.startDate)}－${formatIsoDateZh(report.endDate)}`;
  const drift = report.largestAllocationDrift;

  return (
    <article className="weekly-report glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">每週投資週報</p>
          <h2 className="mt-1 text-xl font-semibold">這週的資產脈動</h2>
          <p className="mt-1 text-xs text-muted">{period}</p>
        </div>
        {report.usesPreviousDate && (
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">沿用最近行情</span>
        )}
      </div>

      <p className="mt-5 rounded-2xl bg-surface-raised/70 p-4 text-sm leading-6">
        期間市場未實現損益
        <strong className={marketPositive ? "text-gain" : "text-loss"}> {marketPositive ? "增加" : "減少"} {formatCurrency(Math.abs(report.unrealizedChange))}</strong>
        {report.topPositive && <>，最大正貢獻來自 {report.topPositive.name}</>}
        {report.topNegative && <>；主要拖累是 {report.topNegative.name}</>}。
      </p>

      <div className="weekly-metrics mt-4 grid gap-3">
        <Metric label="期末資產" value={formatCurrency(report.endValue)} />
        <Metric label="市場損益變化" value={formatCurrency(report.unrealizedChange)} tone={marketPositive ? "gain" : "loss"} />
        <Metric label="期間已實現" value={formatCurrency(report.realizedPnl)} tone={report.realizedPnl >= 0 ? "gain" : "loss"} />
        <Metric label="新增投入" value={formatCurrency(report.newCapital)} />
      </div>

      {view !== "compact" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Insight
            label="主要貢獻"
            text={report.topPositive
              ? `${report.topPositive.name} ${formatCurrency(report.topPositive.amount)}`
              : "本期沒有正貢獻標的"}
            tone="gain"
          />
          <Insight
            label="主要拖累"
            text={report.topNegative
              ? `${report.topNegative.name} ${formatCurrency(report.topNegative.amount)}`
              : "本期沒有負貢獻標的"}
            tone="loss"
          />
        </div>
      )}

      {drift && Math.abs(drift.difference) >= 1 && (
        <p className="mt-4 text-xs text-muted">
          配置提醒：{getAssetTypeLabel(drift.assetType)}目前 {drift.currentPercent.toFixed(1)}%，較目標{drift.difference > 0 ? "高" : "低"} {Math.abs(drift.difference).toFixed(1)} 個百分點。
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted">週報依目前仍持有部位與賣出紀錄估算，不代表投資建議。</p>
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl bg-surface-raised/60 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}>{value}</p>
    </div>
  );
}

function Insight({ label, text, tone }: { label: string; text: string; tone: "gain" | "loss" }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`mt-1 text-sm font-medium ${tone === "gain" ? "text-gain" : "text-loss"}`}>{text}</p>
    </div>
  );
}
