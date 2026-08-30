"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type { Loan } from "@/lib/types/loan";

export function LoanBalanceModal({
  loan,
  currentPrincipal,
  onSave,
  onClose,
}: {
  loan: Loan;
  currentPrincipal: number;
  onSave: (balance: number, effectiveDate: string) => void;
  onClose: () => void;
}) {
  const [balance, setBalance] = useState(String(Math.round(currentPrincipal)));
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const amount = Number.parseFloat(balance);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("目前本金不可小於 0");
      return;
    }
    onSave(amount, effectiveDate);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="loan-balance-title">
      <form onSubmit={handleSubmit} className="glass-card w-full max-w-md space-y-5 rounded-b-none p-5 sm:rounded-2xl sm:p-6">
        <div>
          <p className="text-xs text-muted">{loan.name}</p>
          <h2 id="loan-balance-title" className="mt-1 text-lg font-semibold">更新目前本金</h2>
          <p className="mt-2 text-sm text-muted">更新前 {formatCurrency(currentPrincipal)}；新金額會自生效日起影響利息與維持率，不會回寫更早期間。</p>
        </div>
        <label className="block text-sm">
          <span className="text-muted">生效日 *</span>
          <span className="mt-1 block"><DatePicker value={effectiveDate} onChange={setEffectiveDate} min={loan.trackingStartDate} max={todayIsoDate()} /></span>
        </label>
        <label className="block text-sm">
          <span className="text-muted">當日本金 *</span>
          <input type="number" min="0" step="1" className="input-field mt-1" value={balance} onChange={(event) => setBalance(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn-primary">儲存本金快照</button>
        </div>
      </form>
    </div>
  );
}
