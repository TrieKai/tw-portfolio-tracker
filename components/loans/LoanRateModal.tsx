"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import type { CreateLoanRateChangeInput, Loan } from "@/lib/types/loan";

export function LoanRateModal({
  loan,
  currentRate,
  onSave,
  onClose,
}: {
  loan: Loan;
  currentRate: number;
  onSave: (input: CreateLoanRateChangeInput) => void;
  onClose: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [annualInterestRate, setAnnualInterestRate] = useState(
    String(currentRate)
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const rate = Number.parseFloat(annualInterestRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError("年利率必須介於 0% 到 100%");
      return;
    }
    onSave({
      effectiveDate,
      annualInterestRate: rate,
      note: note.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="loan-rate-title">
      <form onSubmit={handleSubmit} className="glass-card w-full max-w-md space-y-5 rounded-b-none p-5 sm:rounded-2xl sm:p-6">
        <div>
          <p className="text-xs text-muted">{loan.name}</p>
          <h2 id="loan-rate-title" className="mt-1 text-lg font-semibold">記錄利率異動</h2>
          <p className="mt-2 text-sm text-muted">目前年利率 {currentRate}%；新利率只從生效日起計息，不會改寫先前期間。</p>
        </div>
        <label className="block text-sm"><span className="text-muted">生效日 *</span><span className="mt-1 block"><DatePicker value={effectiveDate} onChange={setEffectiveDate} min={loan.trackingStartDate} /></span></label>
        <label className="block text-sm"><span className="text-muted">新年利率（%）*</span><input type="number" min="0" max="100" step="0.001" className="input-field mt-1" value={annualInterestRate} onChange={(event) => setAnnualInterestRate(event.target.value)} /></label>
        <label className="block text-sm"><span className="text-muted">異動原因（選填）</span><input className="input-field mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：指標利率調整" /></label>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>取消</button><button type="submit" className="btn-primary">儲存利率異動</button></div>
      </form>
    </div>
  );
}
