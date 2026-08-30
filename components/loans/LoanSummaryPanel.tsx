import Link from "next/link";
import { formatFinancingCostImpact } from "@/lib/loans/format";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type {
  PortfolioLoanRiskSummary,
  PortfolioLoanSummary,
  LoanReminder,
} from "@/lib/types/loan";

export function LoanSummaryPanel({
  summary,
  riskSummary,
  reminders = [],
}: {
  summary: PortfolioLoanSummary;
  riskSummary?: PortfolioLoanRiskSummary;
  reminders?: LoanReminder[];
}) {
  if (summary.activeLoanCount === 0) {
    return (
      <section className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div><h2 className="font-semibold">貸款與融資成本</h2><p className="mt-1 text-sm text-muted">新增貸款後，系統會另外顯示扣息後淨損益。</p></div>
        <Link href="/loans" className="btn-secondary text-center text-sm">新增貸款</Link>
      </section>
    );
  }

  const netPositive = summary.netInvestmentPnl >= 0;
  return (
    <section className="glass-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-semibold">貸款與扣息後績效</h2><p className="mt-1 text-xs text-muted">投資損益維持原口徑，融資成本另外扣除</p></div>
        <Link href="/loans" className="text-sm font-medium text-accent hover:underline">管理貸款 →</Link>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="貸款總額" value={formatCurrency(summary.totalDebt)} />
        <Metric label="累計投資融資成本" value={formatFinancingCostImpact(summary.investmentFinancingCostToDate)} loss={summary.investmentFinancingCostToDate > 0} gain={summary.investmentFinancingCostToDate < 0} />
        <Metric label="本月融資成本" value={formatFinancingCostImpact(summary.monthlyInvestmentFinancingCost)} loss={summary.monthlyInvestmentFinancingCost > 0} gain={summary.monthlyInvestmentFinancingCost < 0} />
        <Metric label="扣息後淨損益" value={formatCurrency(summary.netInvestmentPnl)} gain={netPositive} loss={!netPositive} />
      </dl>
      {summary.hasIncompleteData ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">部分貸款採估算或待補資料；詳細可信範圍請至貸款頁查看。</p> : null}
      {riskSummary && riskSummary.monitoredLoanCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-xs">
          <span className="text-muted">擔保／循環額度 {riskSummary.monitoredLoanCount} 筆</span>
          <span className={riskSummary.criticalCount > 0 ? "font-medium text-rose-500" : "text-muted"}>需處理 {riskSummary.criticalCount}</span>
          <span className={riskSummary.warningCount > 0 ? "font-medium text-amber-600 dark:text-amber-300" : "text-muted"}>警示 {riskSummary.warningCount}</span>
          <span className="text-muted">最低維持率 {riskSummary.lowestMaintenanceRatioPercent === null ? "—" : `${riskSummary.lowestMaintenanceRatioPercent.toFixed(1)}%`}</span>
        </div>
      ) : null}
      {reminders.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-medium">貸款提醒 {reminders.length} 項</span>
          <span className={reminders.some((item) => item.severity === "critical") ? "text-rose-500" : "text-muted"}>需立即處理 {reminders.filter((item) => item.severity === "critical").length}</span>
          <span className={reminders.some((item) => item.severity === "warning") ? "text-amber-600 dark:text-amber-300" : "text-muted"}>近期注意 {reminders.filter((item) => item.severity === "warning").length}</span>
          <Link href="/loans" className="font-medium text-accent hover:underline">查看提醒 →</Link>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, gain, loss }: { label: string; value: string; gain?: boolean; loss?: boolean }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className={`mt-1 font-semibold tabular-nums ${gain ? "text-gain" : loss ? "text-loss" : ""}`}>{value}</dd></div>;
}
