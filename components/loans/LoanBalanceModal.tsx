"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { Modal } from "@/components/ui/Modal";
import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { principalAtDate } from "@/lib/loans/calculations";
import { isDateInLoanTracking, loanActualEntryEndDate } from "@/lib/loans/history";
import type { Loan } from "@/lib/types/loan";

export function LoanBalanceModal({
  loan,
  onSave,
  onClose,
}: {
  loan: Loan;
  onSave: (balance: number, effectiveDate: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { formatAmount } = useAmountPrivacy();
  const lastDate = loanActualEntryEndDate(loan);
  const [effectiveDate, setEffectiveDate] = useState(lastDate);
  const [manualBalance, setManualBalance] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validDate = isDateInLoanTracking(loan, effectiveDate) && effectiveDate <= lastDate;
  const principalOnDate = validDate ? principalAtDate(loan, effectiveDate) : undefined;
  const balance = manualBalance ?? (principalOnDate === undefined ? "" : String(Math.round(principalOnDate)));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!validDate) return setError(`請選擇 ${loan.trackingStartDate} 至 ${lastDate} 的生效日。`);
    const amount = Number.parseFloat(balance);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("目前本金不可小於 0");
      return;
    }
    setSaving(true);
    const saved = await onSave(amount, effectiveDate);
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
  }

  return (
    <Modal labelledBy="loan-balance-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="glass-card w-full max-w-md space-y-5 rounded-b-none p-5 sm:rounded-2xl sm:p-6">
        <div>
          <p className="text-xs text-muted">{loan.name}</p>
          <h2 id="loan-balance-title" className="mt-1 text-lg font-semibold">更新目前本金</h2>
          <p className="mt-2 text-sm text-muted">本金快照自生效日起影響利息與維持率。</p>
        </div>
        <label className="block text-sm">
          <span className="text-muted">生效日 *</span>
          <span className="mt-1 block"><DatePicker value={effectiveDate} onChange={(date) => { setEffectiveDate(date); setError(null); }} min={loan.trackingStartDate} max={lastDate} required /></span>
        </label>
        {principalOnDate !== undefined && <p className="text-sm text-muted" role="status">生效日參考本金 {formatAmount(principalOnDate)}</p>}
        <label className="block text-sm">
          <span className="text-muted">當日本金 *</span>
          <input type="number" min="0" step="1" className="input-field mt-1" value={balance} onChange={(event) => setManualBalance(event.target.value)} required />
        </label>
        {error ? <p role="alert" className="text-sm text-loss">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" disabled={saving} className="btn-primary">儲存本金快照</button>
        </div>
      </form>
    </Modal>
  );
}
