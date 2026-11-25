"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { type FormEvent, useMemo, useState } from "react";
import { LoanFormModal } from "@/components/loans/LoanFormModal";
import { LoanBalanceModal } from "@/components/loans/LoanBalanceModal";
import { LoanPaymentModal } from "@/components/loans/LoanPaymentModal";
import { LoanRateModal } from "@/components/loans/LoanRateModal";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { DatePicker } from "@/components/ui/DatePicker";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Modal } from "@/components/ui/Modal";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
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
import type {
  CreateLoanInput,
  Loan,
  LoanCollateralValuation,
  LoanRiskLevel,
} from "@/lib/types/loan";
import { usePortfolio } from "@/providers/PortfolioProvider";

export function LoanManager() {
  const { formatAmount } = useAmountPrivacy();
  const {
    ready,
    loans,
    loanSummary,
    loanReminders,
    storage,
    addLoan,
    editLoan,
    updateLoanBalance,
    recordLoanPayment,
    recordLoanRateChange,
    setLoanStatus,
  } = usePortfolio();
  const [formOpen, setFormOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [balanceLoan, setBalanceLoan] = useState<Loan | null>(null);
  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null);
  const [rateLoan, setRateLoan] = useState<Loan | null>(null);
  const [closingLoan, setClosingLoan] = useState<Loan | null>(null);
  const [reopeningLoan, setReopeningLoan] = useState<Loan | null>(null);
  const [restartOf, setRestartOf] = useState<Loan | null>(null);
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

  async function saveLoan(input: CreateLoanInput) {
    const saved = editingLoan
      ? await editLoan({ ...input, id: editingLoan.id })
      : await addLoan(input, restartOf?.id);
    if (!saved) return false;
    setEditingLoan(null);
    setRestartOf(null);
    setFormOpen(false);
    return true;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="貸款管理"
        description="本金影響淨資產；利息與費用才會影響扣息後損益"
        action={loans.length > 0 ? <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setFormOpen(true)}>新增貸款</button> : undefined}
      />

      {loans.length > 0 && <section className="metric-grid-container" aria-label="貸款摘要">
        <div className="metric-grid">
        <Metric label="貸款總額" value={formatAmount(loanSummary.totalDebt)} />
        <Metric label="投資用途本金" value={formatAmount(loanSummary.investmentDebt)} />
        <Metric label="本月融資成本" value={formatAmount(loanSummary.monthlyInvestmentFinancingCost)} />
        <Metric
          label="近期應繳"
          value={loanSummary.nextPaymentDate ? formatAmount(loanSummary.nextPaymentAmount) : "—"}
          sub={loanSummary.nextPaymentDate ?? "尚無還款預估"}
        />
        </div>
      </section>}

      {loanSummary.hasIncompleteData ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          部分貸款採估算或由舊資料遷移；待補資料可能低估融資成本，估算資料則只從本金基準日起計算。
        </p>
      ) : null}

      {loanReminders.length > 0 ? (
        <section className="glass-card space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-semibold">貸款提醒</h2><p className="mt-1 text-xs text-muted">依繳款日、到期日、維持率與對帳狀態整理</p></div>
            <span className="rounded-full bg-surface-raised px-2.5 py-1 text-xs text-muted">{loanReminders.length} 項</span>
          </div>
          <div className="space-y-2">
            {loanReminders.map((reminder) => {
              const loan = activeSnapshots.find((snapshot) => snapshot.loan.id === reminder.loanId)?.loan;
              return (
                <div key={reminder.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${reminder.severity === "critical" ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : reminder.severity === "warning" ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300" : "border-border bg-surface-raised text-muted"}`}>
                  <p><span className="font-medium">{reminder.loanName}</span> · {reminder.message}{reminder.amount !== undefined && ` ${formatAmount(reminder.amount)}`}</p>
                  {loan && (reminder.kind === "payment_due" ? (
                    <button type="button" className="btn-secondary" onClick={() => setPaymentLoan(loan)}>
                      記錄繳款
                    </button>
                  ) : (
                    <a href={`#loan-${loan.id}`} className="btn-secondary">查看貸款</a>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
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
        {activeSnapshots.length === 0 ? (
          <EmptyState
            title={loans.length ? "目前沒有進行中的貸款" : "尚無貸款資料"}
            description="新增貸款後，即可查看還款預估與扣息後投資損益。"
            action={loans.length === 0 ? <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>新增第一筆貸款</button> : undefined}
          />
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">進行中的貸款</h2>
            {activeSnapshots.map((snapshot) => (
              <LoanCard
                key={snapshot.loan.id}
                snapshot={snapshot}
                linkedHoldingName={storage.holdings.find((holding) => holding.id === snapshot.loan.linkedHoldingId)?.name}
                risk={riskByLoanId.get(snapshot.loan.id)}
                onEdit={() => setEditingLoan(snapshot.loan)}
                onRecordPayment={() => setPaymentLoan(snapshot.loan)}
                onRecordRate={() => setRateLoan(snapshot.loan)}
                onUpdateBalance={hasFlexibleCredit(snapshot.loan) ? () => setBalanceLoan(snapshot.loan) : undefined}
                onPaidOff={() => setClosingLoan(snapshot.loan)}
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
                onReopen={loans.some((loan) => loan.restartedFromLoanId === snapshot.loan.id) ? undefined : () => setReopeningLoan(snapshot.loan)}
              />
            ))}
          </div>
        </details>
      ) : null}

      {formOpen || editingLoan || restartOf ? (
        <LoanFormModal
          loan={editingLoan ?? undefined}
          restartOf={restartOf ?? undefined}
          holdings={storage.holdings}
          onSave={saveLoan}
          onClose={() => { setEditingLoan(null); setRestartOf(null); setFormOpen(false); }}
        />
      ) : null}
      {balanceLoan ? (
        <LoanBalanceModal
          loan={balanceLoan}
          currentPrincipal={calculateLoanSnapshot(balanceLoan, today).currentPrincipal}
          onSave={async (balance, effectiveDate) => {
            const saved = await updateLoanBalance(balanceLoan.id, balance, effectiveDate);
            if (saved) setBalanceLoan(null);
            return saved;
          }}
          onClose={() => setBalanceLoan(null)}
        />
      ) : null}
      {paymentLoan ? (
        <LoanPaymentModal
          loan={paymentLoan}
          currentPrincipal={calculateLoanSnapshot(paymentLoan, today).currentPrincipal}
          onSave={async (input) => {
            const saved = await recordLoanPayment(paymentLoan.id, input);
            if (saved) setPaymentLoan(null);
            return saved;
          }}
          onClose={() => setPaymentLoan(null)}
        />
      ) : null}
      {rateLoan ? (
        <LoanRateModal
          loan={rateLoan}
          currentRate={calculateLoanSnapshot(rateLoan, today).currentAnnualInterestRate}
          onSave={async (input) => {
            const saved = await recordLoanRateChange(rateLoan.id, input);
            if (saved) setRateLoan(null);
            return saved;
          }}
          onClose={() => setRateLoan(null)}
        />
      ) : null}
      {reopeningLoan && (
        <LoanReopenModal
          loan={reopeningLoan}
          onClose={() => setReopeningLoan(null)}
          onUndo={async () => {
            const saved = await setLoanStatus(reopeningLoan.id, "active", today);
            if (saved) setReopeningLoan(null);
            return saved;
          }}
          onRestart={() => {
            setRestartOf({
              ...reopeningLoan,
              annualInterestRate: calculateLoanSnapshot(reopeningLoan, today).currentAnnualInterestRate,
            });
            setReopeningLoan(null);
          }}
        />
      )}
      {closingLoan && (
        <LoanClosureModal
          loan={closingLoan}
          onClose={() => setClosingLoan(null)}
          onSave={async (date) => {
            const saved = await setLoanStatus(closingLoan.id, "paid_off", date);
            if (saved) setClosingLoan(null);
            return saved;
          }}
        />
      )}
    </div>
  );
}

function LoanReopenModal({
  loan,
  onClose,
  onUndo,
  onRestart,
}: {
  loan: Loan;
  onClose: () => void;
  onUndo: () => Promise<boolean>;
  onRestart: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Modal labelledBy="loan-reopen-title" onClose={onClose}>
      <div className="glass-card w-full max-w-md space-y-4 rounded-b-none p-5 sm:rounded-2xl">
        <h2 id="loan-reopen-title" className="text-lg font-semibold">恢復追蹤 {loan.name}</h2>
        <div className="space-y-2">
          <p className="text-sm text-muted">重新借款時，原有清償紀錄會保留。新一期自填寫的起算日計息。</p>
          <button type="button" disabled={saving || !loan.closedAt} onClick={onRestart} className="btn-primary w-full">開始新的追蹤</button>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-muted">如果先前誤記清償，可以撤銷並補算原清償日之後的利息。</p>
          <button type="button" disabled={saving} className="btn-secondary w-full" onClick={async () => {
            setSaving(true);
            const saved = await onUndo();
            setSaving(false);
            setFailed(!saved);
          }}>撤銷清償紀錄</button>
        </div>
        {failed && <ErrorAlert message="未能撤銷清償，請確認貸款狀態與瀏覽器儲存空間後重試。" />}
        <button type="button" onClick={onClose} className="btn-secondary w-full">取消</button>
      </div>
    </Modal>
  );
}

function LoanClosureModal({
  loan,
  onClose,
  onSave,
}: {
  loan: Loan;
  onClose: () => void;
  onSave: (date: string) => Promise<boolean>;
}) {
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoDate();
  const earliest = [
    loan.trackingStartDate,
    ...(loan.paymentHistory ?? []).map((payment) => payment.paymentDate),
    ...(loan.balanceHistory ?? []).map((balance) => balance.effectiveDate),
  ].reduce((latest, date) => (date <= today && date > latest ? date : latest), loan.trackingStartDate);

  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const date = String(new FormData(event.currentTarget).get("closedAt") ?? "");
    if (!parseIsoDate(date) || date < earliest || date > today) {
      setError("清償日須介於最後一筆本金或繳款紀錄與今天之間。");
      return;
    }
    setSaving(true);
    const saved = await onSave(date);
    setSaving(false);
    if (!saved) setError("未能儲存清償紀錄，請確認貸款狀態後重試。");
  }

  return (
    <Modal labelledBy="loan-closure-title" onClose={onClose}>
      <form onSubmit={submit} className="glass-card w-full max-w-md space-y-4 rounded-b-none p-5 sm:rounded-2xl">
        <div>
          <h2 id="loan-closure-title" className="text-lg font-semibold">確認貸款清償</h2>
          <p className="mt-1 break-words text-sm text-muted">
            {loan.name} 將移至已清償紀錄。清償日起停止計入未償本金與後續利息。
          </p>
        </div>
        <label className="block text-sm font-medium">
          清償生效日
          <DatePicker name="closedAt" defaultValue={today} min={earliest} max={today} required className="mt-1.5" />
        </label>
        {error && <ErrorAlert message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">取消</button>
          <button type="submit" disabled={saving} className="btn-primary">確認清償</button>
        </div>
      </form>
    </Modal>
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
  onRecordPayment,
  onRecordRate,
}: {
  snapshot: ReturnType<typeof calculateLoanSnapshot>;
  linkedHoldingName?: string;
  risk?: LoanCollateralValuation;
  onEdit: () => void;
  onPaidOff?: () => void;
  onReopen?: () => void;
  onUpdateBalance?: () => void;
  onRecordPayment?: () => void;
  onRecordRate?: () => void;
}) {
  const { formatAmount } = useAmountPrivacy();
  const { loan } = snapshot;
  const flexibleCredit = hasFlexibleCredit(loan);
  const futureSchedule = loan.status === "active"
    ? snapshot.schedule.filter((row) => row.paymentDate > todayIsoDate())
    : [];
  return (
    <article id={`loan-${loan.id}`} className="glass-card p-4 sm:p-5">
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
          {onRecordPayment ? <button type="button" className="btn-secondary text-sm" onClick={onRecordPayment}>記錄繳款</button> : null}
          {onRecordRate ? <button type="button" className="btn-secondary text-sm" onClick={onRecordRate}>利率異動</button> : null}
          {onUpdateBalance ? <button type="button" className="btn-secondary text-sm" onClick={onUpdateBalance}>更新餘額</button> : null}
          <button type="button" className="btn-secondary text-sm" onClick={onEdit}>更正資料</button>
          {onPaidOff ? <button type="button" className="btn-secondary text-sm" onClick={onPaidOff}>標記已清償…</button> : null}
          {onReopen ? <button type="button" className="btn-secondary text-sm" onClick={onReopen}>恢復追蹤</button> : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="目前本金" value={formatAmount(snapshot.currentPrincipal)} />
        <Stat label="目前年利率" value={`${snapshot.currentAnnualInterestRate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`} />
        <Stat label="實質年利率" value={snapshot.effectiveAprPercent === null ? "—" : `${snapshot.effectiveAprPercent.toFixed(2)}%`} sub={snapshot.effectiveAprPercent === null ? "未來利率或現金流不固定" : "含開辦費的年化估算"} />
        <Stat label="下次應繳" value={snapshot.nextPayment ? formatAmount(snapshot.nextPayment.payment) : "—"} sub={snapshot.nextPayment?.paymentDate} />
        <Stat
          label={flexibleCredit ? "契約額度" : "預估剩餘利息"}
          value={
            flexibleCredit
              ? loan.creditLimit === undefined
                ? "—"
                : formatAmount(loan.creditLimit)
              : snapshot.projectedInterest === null
                ? "—"
                : formatAmount(snapshot.projectedInterest)
          }
        />
      </dl>

      {flexibleCredit && risk ? (
        <FlexibleCreditDetails loan={loan} risk={risk} />
      ) : null}

      <LoanHistoryDetails loan={loan} />

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
                    <td className="px-3 py-2">{row.installment}</td><td className="px-3 py-2">{row.paymentDate}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.principal)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.interest)}</td><td className="px-3 py-2 text-right font-medium tabular-nums">{formatAmount(row.payment)}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{formatAmount(row.remainingPrincipal)}</td>
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
  return <div><p className="text-sm text-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>{sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}</div>;
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
  const { formatAmount } = useAmountPrivacy();
  const secured = hasCollateralRisk(loan);
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {secured ? <Stat label="擔保品市值" value={formatAmount(risk.collateralMarketValue)} /> : null}
        {secured ? <Stat label="目前維持率" value={risk.maintenanceRatioPercent === null ? "—" : `${risk.maintenanceRatioPercent.toFixed(1)}%`} /> : null}
        {secured ? <Stat label="距警示可跌" value={risk.warningBufferPercent === null ? "—" : `${risk.warningBufferPercent.toFixed(1)}%`} /> : null}
        {secured ? <Stat label="距追繳可跌" value={risk.callBufferPercent === null ? "—" : `${risk.callBufferPercent.toFixed(1)}%`} /> : null}
        {loan.creditLimit !== undefined ? <Stat label="額度使用率" value={risk.creditUtilizationPercent === null ? "—" : `${risk.creditUtilizationPercent.toFixed(1)}%`} /> : null}
        {loan.creditLimit !== undefined ? <Stat label="尚可動用" value={risk.availableCredit === null ? "—" : formatAmount(risk.availableCredit)} /> : null}
        {loan.maturityDate ? <Stat label="契約到期日" value={loan.maturityDate} sub={risk.daysToMaturity === null ? undefined : risk.daysToMaturity < 0 ? `已逾期 ${Math.abs(risk.daysToMaturity)} 天` : `剩餘 ${risk.daysToMaturity} 天`} /> : null}
      </dl>
      {risk.missingPositionCount > 0 ? <p className="rounded-lg bg-amber-400/10 p-3 text-xs text-amber-700 dark:text-amber-300">有 {risk.missingPositionCount} 筆擔保品缺價、遺失或數量超過追蹤持倉，目前維持率不可作為完整判斷。</p> : null}
      {risk.usesManualCollateralValue ? <p className="text-xs text-muted">包含手動輸入的外部擔保品市值；價格變動後請自行更新。</p> : null}
      <p className="text-xs text-muted">{secured ? "維持率與可跌幅是依目前價格的即時估算，實際追繳仍以券商或銀行認定為準。" : "循環額度沒有固定還款表；本金變動時請更正目前動用金額。"}</p>
    </div>
  );
}

function LoanHistoryDetails({ loan }: { loan: Loan }) {
  const { formatAmount } = useAmountPrivacy();
  const payments = [...(loan.paymentHistory ?? [])].sort(
    (a, b) =>
      b.paymentDate.localeCompare(a.paymentDate) ||
      b.createdAt.localeCompare(a.createdAt)
  );
  const rates = [...(loan.rateHistory ?? [])].sort(
    (a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate) ||
      b.createdAt.localeCompare(a.createdAt)
  );
  if (payments.length === 0 && rates.length === 0) return null;

  return (
    <details className="mt-5 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm font-medium text-accent">帳務紀錄（繳款 {payments.length}、利率異動 {rates.length}）</summary>
      <div className="mt-3 space-y-4">
        {payments.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">最近繳款</p>
            {payments.slice(0, 8).map((payment) => {
              const cashOutflow = payment.principalPaid + payment.interestPaid + payment.feePaid - payment.subsidyReceived;
              const reconciled = !!payment.interestPeriodStartDate && !!payment.interestPeriodEndDate;
              return (
                <div key={payment.id} className="rounded-lg bg-surface-raised p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{payment.paymentDate}</span><span className="tabular-nums">實付 {formatAmount(cashOutflow)}</span></div>
                  <p className="mt-1 text-xs text-muted">本金 {formatAmount(payment.principalPaid)} · 利息 {formatAmount(payment.interestPaid)} · 費用 {formatAmount(payment.feePaid)}{payment.subsidyReceived > 0 ? ` · 補貼 ${formatAmount(payment.subsidyReceived)}` : ""}</p>
                  <p className={`mt-1 text-xs ${reconciled ? "text-emerald-600 dark:text-emerald-300" : payment.interestPaid > 0 ? "text-amber-600 dark:text-amber-300" : "text-muted"}`}>{reconciled ? `已對帳 ${payment.interestPeriodStartDate}～${payment.interestPeriodEndDate}` : payment.interestPaid > 0 ? "尚未指定計息期間，損益仍採估算" : "本次無利息對帳"}{payment.remainingPrincipalAfter !== undefined ? ` · 餘額 ${formatAmount(payment.remainingPrincipalAfter)}` : ""}</p>
                </div>
              );
            })}
          </div>
        ) : null}
        {rates.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">利率異動</p>
            {rates.slice(0, 8).map((change) => <div key={change.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-raised p-3 text-sm"><span>{change.effectiveDate}{change.note ? ` · ${change.note}` : ""}</span><span className="font-medium tabular-nums">{change.annualInterestRate}%</span></div>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}
