"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { Modal } from "@/components/ui/Modal";
import { type FormEvent, useId, useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { parseIsoDate } from "@/lib/date/iso-date";
import { loanInstallmentOptions } from "@/lib/loans/calculations";
import { isDateInLoanTracking, loanActualEntryEndDate, recordedPrincipalOn } from "@/lib/loans/history";
import type { CreateLoanPaymentInput, Loan, LoanPaymentRecord, LoanScheduleRow } from "@/lib/types/loan";

function optionalAmount(value: string): number {
  return value.trim() ? Number.parseFloat(value) : 0;
}

export function LoanPaymentModal({
  loan,
  defaultInstallmentDueDate,
  onSave,
  onClose,
}: {
  loan: Loan;
  defaultInstallmentDueDate?: string;
  onSave: (input: CreateLoanPaymentInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const { formatAmount } = useAmountPrivacy();
  const lastDate = loanActualEntryEndDate(loan);
  const [paymentDate, setPaymentDate] = useState(lastDate);
  const [installmentDueDate, setInstallmentDueDate] = useState(defaultInstallmentDueDate ?? "");
  const [principalPaid, setPrincipalPaid] = useState("");
  const [interestPaid, setInterestPaid] = useState("");
  const [feePaid, setFeePaid] = useState("");
  const [subsidyReceived, setSubsidyReceived] = useState("");
  const [remainingPrincipalAfter, setRemainingPrincipalAfter] = useState("");
  const [reconcileInterest, setReconcileInterest] = useState(false);
  const [interestPeriodStartDate, setInterestPeriodStartDate] = useState("");
  const [interestPeriodEndDate, setInterestPeriodEndDate] = useState(lastDate);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validPaymentDate = isDateInLoanTracking(loan, paymentDate) && paymentDate <= lastDate;
  const principalOnPaymentDate = validPaymentDate ? recordedPrincipalOn(loan, paymentDate) : undefined;
  const installments = useMemo(() => loanInstallmentOptions(loan), [loan]);
  const invalidInstallment = !!installmentDueDate && !installments.some((row) => row.paymentDate === installmentDueDate);

  function changePaymentDate(date: string) {
    setPaymentDate(date);
    setError(null);
    if (interestPeriodEndDate > date) setInterestPeriodEndDate(date);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (principalOnPaymentDate === undefined) {
      return setError(`請選擇 ${loan.trackingStartDate} 至 ${lastDate} 的付款日。`);
    }
    if (invalidInstallment) return setError("這個期別已變更，請重新選擇。");
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
    if (remaining !== undefined && remaining > principalOnPaymentDate) {
      return setError("繳款後本金超過付款日已知本金。請核對帳單與付款日。");
    }
    if (
      principal + interest + fee + subsidy === 0 &&
      remaining === undefined
    ) {
      return setError("請至少輸入一項繳款或本金資料");
    }
    if (reconcileInterest) {
      if (!parseIsoDate(interestPeriodStartDate) || !parseIsoDate(interestPeriodEndDate)) {
        return setError("利息對帳需要完整的計息起訖日");
      }
      if (interestPeriodStartDate < loan.trackingStartDate) return setError("計息起日須在貸款追蹤期間內。");
      if (interestPeriodStartDate >= interestPeriodEndDate) {
        return setError("計息迄日必須晚於起日");
      }
      if (interestPeriodEndDate > paymentDate) {
        return setError("計息迄日不可晚於付款日");
      }
    }

    setSaving(true);
    const saved = await onSave({
      paymentDate,
      installmentDueDate: installmentDueDate || undefined,
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
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
  }

  return (
    <Modal labelledBy="loan-payment-title" onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="glass-card flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-b-none sm:rounded-2xl">
        <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div>
            <p className="text-xs text-muted">{loan.name}</p>
            <h2 id="loan-payment-title" className="mt-1 text-lg font-semibold">{loan.status === "active" ? "記錄實際繳款" : "補登繳款"}</h2>
            {loan.status !== "active" && <p className="mt-1 text-sm text-muted">可補登至 {lastDate} 清償／轉貸日。</p>}
          </div>

          <label className="block text-sm">
            <span className="text-muted">付款日 *</span>
            <span className="mt-1 block"><DatePicker value={paymentDate} onChange={changePaymentDate} min={loan.trackingStartDate} max={lastDate} required /></span>
          </label>
          {principalOnPaymentDate !== undefined && (
            <p className="text-sm text-muted" role="status">付款日已知本金 <span className="font-medium text-foreground">{formatAmount(principalOnPaymentDate)}</span></p>
          )}
          {(installments.length > 0 || invalidInstallment) && (
            <LoanInstallmentField installments={installments} paymentDate={paymentDate || lastDate}
              value={installmentDueDate} onChange={(date) => { setInstallmentDueDate(date); setError(null); }} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField label="償還本金" value={principalPaid} onChange={setPrincipalPaid} />
            <AmountField label="實付利息" value={interestPaid} onChange={setInterestPaid} />
            <AmountField label="本次費用／違約金" value={feePaid} onChange={setFeePaid} />
            <AmountField label="利息補貼／回饋" value={subsidyReceived} onChange={setSubsidyReceived} />
            <AmountField label="繳款後剩餘本金" value={remainingPrincipalAfter} onChange={setRemainingPrincipalAfter} />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={reconcileInterest} onChange={(event) => setReconcileInterest(event.target.checked)} />
            <span><span className="font-medium">以這筆實付利息對帳</span><span className="mt-1 block text-xs text-muted">實付利息會計入付款日，該期的估算利息只扣回一次。</span></span>
          </label>

          {reconcileInterest ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm"><span className="text-muted">計息起日 *</span><span className="mt-1 block"><DatePicker value={interestPeriodStartDate} onChange={setInterestPeriodStartDate} min={loan.trackingStartDate} max={paymentDate} /></span></label>
              <label className="block text-sm"><span className="text-muted">計息迄日 *</span><span className="mt-1 block"><DatePicker value={interestPeriodEndDate} onChange={setInterestPeriodEndDate} min={interestPeriodStartDate || loan.trackingStartDate} max={paymentDate} /></span></label>
            </div>
          ) : null}

          <label className="block text-sm"><span className="text-muted">備註（選填）</span><input className="input-field mt-1" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="shrink-0 border-t border-border px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {error ? <p role="alert" className="mb-2 text-sm text-loss">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 sm:flex-none">{saving ? "儲存中…" : "儲存繳款紀錄"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function LoanInstallmentField({ installments, paymentDate, value, onChange }: {
  installments: LoanScheduleRow[];
  paymentDate: string;
  value: string;
  onChange: (dueDate: string) => void;
}) {
  const hintId = useId();
  const invalid = !!value && !installments.some((row) => row.paymentDate === value);
  const groups = [
    { label: "付款日與之後", rows: installments.filter((row) => row.paymentDate >= paymentDate) },
    { label: "早於付款日", rows: installments.filter((row) => row.paymentDate < paymentDate).reverse() },
  ];
  return (
    <div>
      <label className="block text-sm">
        <span className="text-muted">對應期別（選填）</span>
        <select className="input-field mt-1" value={value} aria-describedby={hintId} onChange={(event) => onChange(event.target.value)}>
          <option value="">未指定期別</option>
          {invalid && <option value={value} disabled>{value} · 期別已變更</option>}
          {groups.filter(({ rows }) => rows.length > 0).map(({ label, rows }) => (
            <optgroup key={label} label={label}>
              {rows.map((row) => <option key={row.paymentDate} value={row.paymentDate}>第 {row.installment} 期 · {row.paymentDate}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <p id={hintId} className="mt-1 text-sm text-muted">提前或延後繳期款時，請選帳單應繳日。另行還本可留白。</p>
    </div>
  );
}

export function LoanInstallmentEditForm({ installments, payment, onSave, onCancel }: {
  installments: LoanScheduleRow[];
  payment: LoanPaymentRecord;
  onSave: (dueDate?: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [dueDate, setDueDate] = useState(payment.installmentDueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = dueDate !== (payment.installmentDueDate ?? "");
  const valid = !dueDate || installments.some((row) => row.paymentDate === dueDate);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !changed || !valid) return;
    setSaving(true);
    const saved = await onSave(dueDate || undefined);
    if (saved) return;
    setSaving(false);
    setError("無法儲存期別，請確認貸款資料後再試。");
  }

  return (
    <form className="mt-3 space-y-2 border-t border-border pt-3" onSubmit={save}>
      <LoanInstallmentField installments={installments} paymentDate={payment.paymentDate} value={dueDate}
        onChange={(date) => { setDueDate(date); setError(null); }} />
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={onCancel}>取消</button>
        <button type="submit" className="btn-primary text-sm" disabled={saving || !changed || !valid}>
          {saving ? "儲存中…" : "儲存期別"}
        </button>
      </div>
    </form>
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
