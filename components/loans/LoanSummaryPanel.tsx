import Link from "next/link";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type { PortfolioLoanSummary } from "@/lib/types/loan";

export function LoanSummaryPanel({ summary }: { summary: PortfolioLoanSummary }) {
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
        <Metric label="累計投資融資成本" value={`−${formatCurrency(summary.investmentFinancingCostToDate)}`} loss />
        <Metric label="本月融資成本" value={`−${formatCurrency(summary.monthlyInvestmentFinancingCost)}`} loss />
        <Metric label="扣息後淨損益" value={formatCurrency(summary.netInvestmentPnl)} gain={netPositive} loss={!netPositive} />
      </dl>
      {summary.hasIncompleteData ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">部分貸款採估算或待補資料；詳細可信範圍請至貸款頁查看。</p> : null}
    </section>
  );
}

function Metric({ label, value, gain, loss }: { label: string; value: string; gain?: boolean; loss?: boolean }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className={`mt-1 font-semibold tabular-nums ${gain ? "text-gain" : loss ? "text-loss" : ""}`}>{value}</dd></div>;
}
