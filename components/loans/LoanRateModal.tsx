"use client";

import { Modal } from "@/components/ui/Modal";
import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { interestRateAtDate } from "@/lib/loans/calculations";
import { isDateInLoanTracking, loanActualEntryEndDate } from "@/lib/loans/history";
import type { CreateLoanRateChangeInput, Loan } from "@/lib/types/loan";

export function LoanRateModal({
  loan,
  onSave,
  onClose,
}: {
  loan: Loan;
  onSave: (input: CreateLoanRateChangeInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(() => loanActualEntryEndDate(loan));
  const [manualRate, setManualRate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validDate = isDateInLoanTracking(loan, effectiveDate);
  const rateOnDate = validDate ? interestRateAtDate(loan, effectiveDate) : undefined;
  const annualInterestRate = manualRate ?? (rateOnDate === undefined ? "" : String(rateOnDate));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!validDate) return setError("請選擇貸款追蹤期間內的生效日。");
    const rate = Number.parseFloat(annualInterestRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError("年利率必須介於 0% 到 100%");
      return;
    }
    setSaving(true);
    const saved = await onSave({
      effectiveDate,
      annualInterestRate: rate,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (!saved) setError("這次變更未儲存。請確認資料狀態與瀏覽器儲存空間後重試。");
  }

  return (
    <Modal labelledBy="loan-rate-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="glass-card w-full max-w-md space-y-5 rounded-b-none p-5 sm:rounded-2xl sm:p-6">
        <div>
          <p className="text-xs text-muted">{loan.name}</p>
          <h2 id="loan-rate-title" className="mt-1 text-lg font-semibold">記錄利率異動</h2>
          <p className="mt-2 text-sm text-muted">新利率自生效日起計息。</p>
        </div>
        <label className="block text-sm"><span className="text-muted">生效日 *</span><span className="mt-1 block"><DatePicker value={effectiveDate} onChange={(date) => { setEffectiveDate(date); setError(null); }} min={loan.trackingStartDate} max={loan.closedAt} required /></span></label>
        {rateOnDate !== undefined && <p className="text-sm text-muted" role="status">生效日參考年利率 {rateOnDate}%</p>}
        <label className="block text-sm"><span className="text-muted">新年利率（%）*</span><input type="number" min="0" max="100" step="0.001" className="input-field mt-1" value={annualInterestRate} onChange={(event) => setManualRate(event.target.value)} required /></label>
        <label className="block text-sm"><span className="text-muted">異動原因（選填）</span><input className="input-field mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：指標利率調整" /></label>
        {error ? <p role="alert" className="text-sm text-loss">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>取消</button><button type="submit" disabled={saving} className="btn-primary">儲存利率異動</button></div>
      </form>
    </Modal>
  );
}
