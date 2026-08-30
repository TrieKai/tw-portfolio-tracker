"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type { CreateLoanPaymentInput, Loan } from "@/lib/types/loan";

function optionalAmount(value: string): number {
  return value.trim() ? Number.parseFloat(value) : 0;
}

export function LoanPaymentModal({
  loan,
  currentPrincipal,
  onSave,
  onClose,
}: {
  loan: Loan;
  currentPrincipal: number;
  onSave: (input: CreateLoanPaymentInput) => void;
  onClose: () => void;
}) {
  const today = todayIsoDate();
  const [paymentDate, setPaymentDate] = useState(today);
  const [principalPaid, setPrincipalPaid] = useState("");
  const [interestPaid, setInterestPaid] = useState("");
  const [feePaid, setFeePaid] = useState("");
  const [subsidyReceived, setSubsidyReceived] = useState("");
  const [remainingPrincipalAfter, setRemainingPrincipalAfter] = useState("");
  const [reconcileInterest, setReconcileInterest] = useState(false);
  const [interestPeriodStartDate, setInterestPeriodStartDate] = useState("");
  const [interestPeriodEndDate, setInterestPeriodEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const principal = optionalAmount(principalPaid);
    const interest = optionalAmount(interestPaid);
    const fee = optionalAmount(feePaid);
    const subsidy = optionalAmount(subsidyReceived);
    const amounts = [principal, interest, fee, subsidy];
    const remaining = remainingPrincipalAfter.trim()
      ? Number.parseFloat(remainingPrincipalAfter)
      : undefined;

    if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
      return setError("繳款金額不可小於 0");
    }
    if (
      remaining !== undefined &&
      (!Number.isFinite(remaining) || remaining < 0)
    ) {
      return setError("繳款後本金不可小於 0");
    }
    if (principal > 0 && remaining === undefined) {
      return setError("有償還本金時，請填寫繳款後剩餘本金");
    }
    if (remaining !== undefined && remaining > currentPrincipal) {
      return setError("繳款後本金不可高於繳款前本金；新增借款請使用更新餘額");
    }
    if (
      principal + interest + fee + subsidy === 0 &&
      remaining === undefined
    ) {
      return setError("請至少輸入一項繳款或本金資料");
    }
    if (reconcileInterest) {
      if (!interestPeriodStartDate || !interestPeriodEndDate) {
        return setError("利息對帳需要完整的計息起訖日");
      }
      if (interestPeriodStartDate >= interestPeriodEndDate) {
        return setError("計息迄日必須晚於起日");
      }
      if (interestPeriodEndDate > paymentDate) {
        return setError("計息迄日不可晚於付款日");
      }
    }

    onSave({
      paymentDate,
      principalPaid: principal,
      interestPaid: interest,
      feePaid: fee,
      subsidyReceived: subsidy,
      remainingPrincipalAfter: remaining,
      interestPeriodStartDate: reconcileInterest
        ? interestPeriodStartDate
        : undefined,
      interestPeriodEndDate: reconcileInterest
        ? interestPeriodEndDate
        : undefined,
      note: note.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="loan-payment-title">
      <form onSubmit={handleSubmit} className="glass-card max-h-[92dvh] w-full max-w-xl space-y-5 overflow-y-auto rounded-b-none p-5 sm:rounded-2xl sm:p-6">
        <div>
          <p className="text-xs text-muted">{loan.name}</p>
          <h2 id="loan-payment-title" className="mt-1 text-lg font-semibold">記錄實際繳款</h2>
          <p className="mt-2 text-sm text-muted">目前本金 {formatCurrency(currentPrincipal)}。本金只降低負債；利息、費用與補貼才影響融資成本。</p>
        </div>

        <label className="block text-sm">
          <span className="text-muted">付款日 *</span>
          <span className="mt-1 block"><DatePicker value={paymentDate} onChange={(date) => { setPaymentDate(date); if (interestPeriodEndDate > date) setInterestPeriodEndDate(date); }} min={loan.trackingStartDate} max={today} /></span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <AmountField label="償還本金" value={principalPaid} onChange={setPrincipalPaid} />
          <AmountField label="實付利息" value={interestPaid} onChange={setInterestPaid} />
          <AmountField label="本次費用／違約金" value={feePaid} onChange={setFeePaid} />
          <AmountField label="利息補貼／回饋" value={subsidyReceived} onChange={setSubsidyReceived} />
          <AmountField label="繳款後剩餘本金" value={remainingPrincipalAfter} onChange={setRemainingPrincipalAfter} />
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={reconcileInterest} onChange={(event) => setReconcileInterest(event.target.checked)} />
          <span><span className="font-medium">以這筆實付利息對帳</span><span className="mt-1 block text-xs text-muted">付款日會加入「實付－估算」差額，讓累計融資成本回到帳單金額。</span></span>
        </label>

        {reconcileInterest ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm"><span className="text-muted">計息起日 *</span><span className="mt-1 block"><DatePicker value={interestPeriodStartDate} onChange={setInterestPeriodStartDate} min={loan.trackingStartDate} max={paymentDate} /></span></label>
            <label className="block text-sm"><span className="text-muted">計息迄日 *</span><span className="mt-1 block"><DatePicker value={interestPeriodEndDate} onChange={setInterestPeriodEndDate} min={interestPeriodStartDate || loan.trackingStartDate} max={paymentDate} /></span></label>
          </div>
        ) : null}

        <label className="block text-sm"><span className="text-muted">備註（選填）</span><input className="input-field mt-1" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn-primary">儲存繳款紀錄</button>
        </div>
      </form>
    </div>
  );
}

function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <label className="block text-sm"><span className="text-muted">{label}（元）</span><input type="number" min="0" step="1" className="input-field mt-1" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
