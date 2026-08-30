"use client";

import { useMemo, useState } from "react";
import { LoanFormModal } from "@/components/loans/LoanFormModal";
import { LoanBalanceModal } from "@/components/loans/LoanBalanceModal";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { todayIsoDate } from "@/lib/date/iso-date";
import { calculateLoanSnapshot } from "@/lib/loans/calculations";
import {
  calculateLoanCollateralValuation,
  calculatePortfolioLoanRiskSummary,
  hasCollateralRisk,
  hasFlexibleCredit,
} from "@/lib/loans/risk";
import {
  LOAN_PURPOSE_LABELS,
  LOAN_QUALITY_LABELS,
  LOAN_RISK_LABELS,
  LOAN_TYPE_LABELS,
  REPAYMENT_METHOD_LABELS,
} from "@/lib/loans/labels";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type {
  CreateLoanInput,
  Loan,
  LoanCollateralValuation,
  LoanRiskLevel,
} from "@/lib/types/loan";
import { usePortfolio } from "@/providers/PortfolioProvider";

export function LoanManager() {
  const {
    ready,
    loans,
    loanSummary,
    storage,
    addLoan,
    editLoan,
    updateLoanBalance,
    setLoanStatus,
  } = usePortfolio();
  const [formOpen, setFormOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [balanceLoan, setBalanceLoan] = useState<Loan | null>(null);
  const today = todayIsoDate();
  const snapshots = useMemo(
    () => loans.map((loan) => calculateLoanSnapshot(loan, today)),
    [loans, today]
  );
  const activeSnapshots = snapshots.filter((snapshot) => snapshot.loan.status === "active");
  const archivedSnapshots = snapshots.filter((snapshot) => snapshot.loan.status !== "active");
  const riskByLoanId = useMemo(
    () =>
      new Map(
        loans.map((loan) => [
          loan.id,
          calculateLoanCollateralValuation(loan, storage.holdings, today),
        ])
      ),
    [loans, storage.holdings, today]
  );
  const riskSummary = useMemo(
    () => calculatePortfolioLoanRiskSummary(loans, storage.holdings, today),
    [loans, storage.holdings, today]
  );

  if (!ready) return <LoadingSpinner />;

  function saveLoan(input: CreateLoanInput) {
    if (editingLoan) {
      editLoan({ ...input, id: editingLoan.id });
    } else {
      addLoan(input);
    }
    setEditingLoan(null);
    setFormOpen(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="貸款管理"
        description="本金影響淨資產；利息與費用才會影響扣息後損益"
        action={<button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setFormOpen(true)}>新增貸款</button>}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="貸款總額" value={formatCurrency(loanSummary.totalDebt)} />
        <Metric label="投資用途本金" value={formatCurrency(loanSummary.investmentDebt)} />
        <Metric label="本月融資成本" value={formatCurrency(loanSummary.monthlyInvestmentFinancingCost)} />
        <Metric
          label="近期應繳"
          value={loanSummary.nextPaymentDate ? formatCurrency(loanSummary.nextPaymentAmount) : "—"}
          sub={loanSummary.nextPaymentDate ?? "尚無還款預估"}
        />
      </section>

      {loanSummary.hasIncompleteData ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          部分貸款採估算或由舊資料遷移；待補資料可能低估融資成本，估算資料則只從本金基準日起計算。
        </p>
      ) : null}

      {riskSummary.monitoredLoanCount > 0 ? (
        <section className="glass-card space-y-4 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold">擔保融資風險</h2>
            <p className="mt-1 text-xs text-muted">維持率依最新持倉價格與你輸入的契約門檻估算</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="監控中額度" value={`${riskSummary.monitoredLoanCount} 筆`} />
            <Stat label="最低維持率" value={riskSummary.lowestMaintenanceRatioPercent === null ? "—" : `${riskSummary.lowestMaintenanceRatioPercent.toFixed(1)}%`} />
            <Stat label="警示／需處理" value={`${riskSummary.warningCount}／${riskSummary.criticalCount}`} />
            <Stat label="最近到期日" value={riskSummary.nextMaturityDate ?? "—"} />
          </dl>
          {riskSummary.unknownCount > 0 ? <p className="text-xs text-amber-600 dark:text-amber-300">另有 {riskSummary.unknownCount} 筆缺少擔保品、有效現價或契約門檻，暫時無法判斷風險。</p> : null}
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">進行中的貸款</h2>
        {activeSnapshots.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <p className="font-medium">尚無貸款資料</p>
            <p className="mt-2 text-sm text-muted">新增後即可查看還款預估與扣息後投資損益。</p>
            <button type="button" className="btn-primary mt-5" onClick={() => setFormOpen(true)}>新增第一筆貸款</button>
          </div>
        ) : (
          <div className="space-y-4">
            {activeSnapshots.map((snapshot) => (
              <LoanCard
                key={snapshot.loan.id}
                snapshot={snapshot}
                linkedHoldingName={storage.holdings.find((holding) => holding.id === snapshot.loan.linkedHoldingId)?.name}
                risk={riskByLoanId.get(snapshot.loan.id)}
                onEdit={() => setEditingLoan(snapshot.loan)}
                onUpdateBalance={hasFlexibleCredit(snapshot.loan) ? () => setBalanceLoan(snapshot.loan) : undefined}
                onPaidOff={() => setLoanStatus(snapshot.loan.id, "paid_off", today)}
              />
            ))}
          </div>
        )}
      </section>

      {archivedSnapshots.length > 0 ? (
        <details className="glass-card p-4 sm:p-5">
          <summary className="cursor-pointer font-semibold">已清償／轉貸（{archivedSnapshots.length}）</summary>
          <div className="mt-4 space-y-3">
            {archivedSnapshots.map((snapshot) => (
              <LoanCard
                key={snapshot.loan.id}
                snapshot={snapshot}
                linkedHoldingName={storage.holdings.find((holding) => holding.id === snapshot.loan.linkedHoldingId)?.name}
                risk={riskByLoanId.get(snapshot.loan.id)}
                onEdit={() => setEditingLoan(snapshot.loan)}
                onReopen={() => setLoanStatus(snapshot.loan.id, "active", today)}
              />
            ))}
          </div>
        </details>
      ) : null}

      {formOpen || editingLoan ? (
        <LoanFormModal
          loan={editingLoan ?? undefined}
          holdings={storage.holdings}
          onSave={saveLoan}
          onClose={() => { setEditingLoan(null); setFormOpen(false); }}
        />
      ) : null}
      {balanceLoan ? (
        <LoanBalanceModal
          loan={balanceLoan}
          currentPrincipal={calculateLoanSnapshot(balanceLoan, today).currentPrincipal}
          onSave={(balance, effectiveDate) => {
            updateLoanBalance(balanceLoan.id, balance, effectiveDate);
            setBalanceLoan(null);
          }}
          onClose={() => setBalanceLoan(null)}
        />
      ) : null}
    </div>
  );
}

function LoanCard({
  snapshot,
  linkedHoldingName,
  risk,
  onEdit,
  onPaidOff,
  onReopen,
  onUpdateBalance,
}: {
  snapshot: ReturnType<typeof calculateLoanSnapshot>;
  linkedHoldingName?: string;
  risk?: LoanCollateralValuation;
  onEdit: () => void;
  onPaidOff?: () => void;
  onReopen?: () => void;
  onUpdateBalance?: () => void;
}) {
  const { loan } = snapshot;
  const flexibleCredit = hasFlexibleCredit(loan);
  const futureSchedule = loan.status === "active"
    ? snapshot.schedule.filter((row) => row.paymentDate > todayIsoDate())
    : [];
  return (
    <article className="glass-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{loan.name}</h3>
            <Badge>{LOAN_TYPE_LABELS[loan.loanType]}</Badge>
            <Badge warn={loan.dataQuality !== "complete"}>{LOAN_QUALITY_LABELS[loan.dataQuality]}</Badge>
            {flexibleCredit && risk ? <RiskBadge level={risk.riskLevel} /> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {loan.lender || "未填貸款人"} · {LOAN_PURPOSE_LABELS[loan.purpose]}
            {loan.investmentUsePercent > 0 && loan.investmentUsePercent < 100 ? ` ${loan.investmentUsePercent}%` : ""}
            {linkedHoldingName ? ` · ${linkedHoldingName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onUpdateBalance ? <button type="button" className="btn-secondary text-sm" onClick={onUpdateBalance}>更新餘額</button> : null}
          <button type="button" className="btn-secondary text-sm" onClick={onEdit}>更正資料</button>
          {onPaidOff ? <button type="button" className="btn-secondary text-sm" onClick={onPaidOff}>標記已清償</button> : null}
          {onReopen ? <button type="button" className="btn-secondary text-sm" onClick={onReopen}>恢復追蹤</button> : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="目前本金" value={formatCurrency(snapshot.currentPrincipal)} />
        <Stat label="年利率" value={`${loan.annualInterestRate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`} />
        <Stat label="下次應繳" value={snapshot.nextPayment ? formatCurrency(snapshot.nextPayment.payment) : "—"} sub={snapshot.nextPayment?.paymentDate} />
        <Stat
          label={flexibleCredit ? "契約額度" : "預估剩餘利息"}
          value={
            flexibleCredit
              ? loan.creditLimit === undefined
                ? "—"
                : formatCurrency(loan.creditLimit)
              : snapshot.projectedInterest === null
                ? "—"
                : formatCurrency(snapshot.projectedInterest)
          }
        />
      </dl>

      {flexibleCredit && risk ? (
        <FlexibleCreditDetails loan={loan} risk={risk} />
      ) : null}

      {!flexibleCredit ? <details className="mt-5 border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium text-accent">
          查看還款預估{futureSchedule.length > 0 ? `（剩餘 ${futureSchedule.length} 期）` : ""}
        </summary>
        {futureSchedule.length === 0 ? (
          <p className="mt-3 text-sm text-muted">尚未填寫剩餘期數，無法建立還款預估。</p>
        ) : (
          <div className="mt-3 max-h-96 overflow-auto [content-visibility:auto]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr><th className="px-3 py-2">期數</th><th className="px-3 py-2">日期</th><th className="px-3 py-2 text-right">本金</th><th className="px-3 py-2 text-right">利息</th><th className="px-3 py-2 text-right">應繳</th><th className="px-3 py-2 text-right">剩餘本金</th></tr>
              </thead>
              <tbody>
                {futureSchedule.map((row) => (
                  <tr key={row.installment} className="border-t border-border/60">
                    <td className="px-3 py-2">{row.installment}</td><td className="px-3 py-2">{row.paymentDate}</td><td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.principal)}</td><td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.interest)}</td><td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(row.payment)}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{formatCurrency(row.remainingPrincipal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details> : null}
      <p className="mt-3 text-xs text-muted">{REPAYMENT_METHOD_LABELS[loan.repaymentMethod]} · {flexibleCredit ? "本金快照保留歷史計息基準；損益利息採實際天數／365 日估算" : "還款表採月利率預估；損益利息採實際天數／365 日估算"}</p>
    </article>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="glass-card p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>{sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}</div>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd>{sub ? <dd className="text-xs text-muted">{sub}</dd> : null}</div>;
}

function Badge({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${warn ? "bg-amber-400/15 text-amber-700 dark:text-amber-300" : "bg-accent-dim text-accent"}`}>{children}</span>;
}

function RiskBadge({ level }: { level: LoanRiskLevel }) {
  const className =
    level === "critical"
      ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
      : level === "warning" || level === "unknown"
        ? "bg-amber-400/15 text-amber-700 dark:text-amber-300"
        : level === "safe"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-surface-raised text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>{LOAN_RISK_LABELS[level]}</span>;
}

function FlexibleCreditDetails({
  loan,
  risk,
}: {
  loan: Loan;
  risk: LoanCollateralValuation;
}) {
  const secured = hasCollateralRisk(loan);
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {secured ? <Stat label="擔保品市值" value={formatCurrency(risk.collateralMarketValue)} /> : null}
        {secured ? <Stat label="目前維持率" value={risk.maintenanceRatioPercent === null ? "—" : `${risk.maintenanceRatioPercent.toFixed(1)}%`} /> : null}
        {secured ? <Stat label="距警示可跌" value={risk.warningBufferPercent === null ? "—" : `${risk.warningBufferPercent.toFixed(1)}%`} /> : null}
        {secured ? <Stat label="距追繳可跌" value={risk.callBufferPercent === null ? "—" : `${risk.callBufferPercent.toFixed(1)}%`} /> : null}
        {loan.creditLimit !== undefined ? <Stat label="額度使用率" value={risk.creditUtilizationPercent === null ? "—" : `${risk.creditUtilizationPercent.toFixed(1)}%`} /> : null}
        {loan.creditLimit !== undefined ? <Stat label="尚可動用" value={risk.availableCredit === null ? "—" : formatCurrency(risk.availableCredit)} /> : null}
        {loan.maturityDate ? <Stat label="契約到期日" value={loan.maturityDate} sub={risk.daysToMaturity === null ? undefined : risk.daysToMaturity < 0 ? `已逾期 ${Math.abs(risk.daysToMaturity)} 天` : `剩餘 ${risk.daysToMaturity} 天`} /> : null}
      </dl>
      {risk.missingPositionCount > 0 ? <p className="rounded-lg bg-amber-400/10 p-3 text-xs text-amber-700 dark:text-amber-300">有 {risk.missingPositionCount} 筆擔保品缺價、遺失或數量超過追蹤持倉，目前維持率不可作為完整判斷。</p> : null}
      {risk.usesManualCollateralValue ? <p className="text-xs text-muted">包含手動輸入的外部擔保品市值；價格變動後請自行更新。</p> : null}
      <p className="text-xs text-muted">{secured ? "維持率與可跌幅是依目前價格的即時估算，實際追繳仍以券商或銀行認定為準。" : "循環額度沒有固定還款表；本金變動時請更正目前動用金額。"}</p>
    </div>
  );
}
