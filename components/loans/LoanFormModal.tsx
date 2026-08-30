"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import {
  LOAN_PURPOSE_LABELS,
  LOAN_TYPE_LABELS,
  REPAYMENT_METHOD_LABELS,
} from "@/lib/loans/labels";
import type { Holding } from "@/lib/types/holding";
import type {
  CreateLoanInput,
  Loan,
  LoanPurpose,
  LoanRateType,
  LoanRepaymentMethod,
  LoanType,
} from "@/lib/types/loan";

const PHASE_ONE_TYPES: LoanType[] = [
  "personal_credit",
  "mortgage",
  "home_equity",
  "policy",
  "private",
  "other",
];
const PURPOSES: LoanPurpose[] = ["investment", "property", "personal", "mixed"];
const METHODS: LoanRepaymentMethod[] = [
  "equal_payment",
  "equal_principal",
  "interest_only",
  "bullet",
];

type EntryMode = "complete" | "quick";

export function LoanFormModal({
  loan,
  holdings,
  onSave,
  onClose,
}: {
  loan?: Loan;
  holdings: Holding[];
  onSave: (input: CreateLoanInput) => void;
  onClose: () => void;
}) {
  const [entryMode, setEntryMode] = useState<EntryMode>(
    loan?.contractStartDate ? "complete" : "quick"
  );
  const [name, setName] = useState(loan?.name ?? "");
  const [lender, setLender] = useState(loan?.lender ?? "");
  const [loanType, setLoanType] = useState<LoanType>(
    loan?.loanType ?? "personal_credit"
  );
  const [purpose, setPurpose] = useState<LoanPurpose>(
    loan?.purpose ?? "investment"
  );
  const [investmentUsePercent, setInvestmentUsePercent] = useState(
    String(loan?.investmentUsePercent ?? 100)
  );
  const [linkedHoldingId, setLinkedHoldingId] = useState(
    loan?.linkedHoldingId ?? ""
  );
  const [balance, setBalance] = useState(String(loan?.openingBalance ?? ""));
  const [trackingStartDate, setTrackingStartDate] = useState(
    loan?.trackingStartDate ?? todayIsoDate()
  );
  const [termMonths, setTermMonths] = useState(
    loan?.remainingTermMonths ? String(loan.remainingTermMonths) : ""
  );
  const [firstPaymentDate, setFirstPaymentDate] = useState(
    loan?.firstPaymentDate ?? ""
  );
  const [annualInterestRate, setAnnualInterestRate] = useState(
    String(loan?.annualInterestRate ?? "")
  );
  const [rateType, setRateType] = useState<LoanRateType>(
    loan?.rateType ?? "fixed"
  );
  const [repaymentMethod, setRepaymentMethod] =
    useState<LoanRepaymentMethod>(loan?.repaymentMethod ?? "equal_payment");
  const [gracePeriodMonths, setGracePeriodMonths] = useState(
    loan?.gracePeriodMonths ? String(loan.gracePeriodMonths) : ""
  );
  const [initialFees, setInitialFees] = useState(
    loan?.initialFees ? String(loan.initialFees) : ""
  );
  const [accountLastFour, setAccountLastFour] = useState(
    loan?.accountLastFour ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  const propertyHoldings = holdings.filter(
    (holding) => holding.assetType === "property"
  );

  function handlePurposeChange(next: LoanPurpose) {
    setPurpose(next);
    if (next === "investment") setInvestmentUsePercent("100");
    if (next === "property" || next === "personal") {
      setInvestmentUsePercent("0");
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const principal = Number.parseFloat(balance);
    const rate = Number.parseFloat(annualInterestRate);
    const months = termMonths.trim() ? Number.parseInt(termMonths, 10) : undefined;
    const grace = gracePeriodMonths.trim()
      ? Number.parseInt(gracePeriodMonths, 10)
      : undefined;
    const fees = initialFees.trim() ? Number.parseFloat(initialFees) : undefined;
    const investmentPercent = Number.parseFloat(investmentUsePercent);

    if (!name.trim()) return setError("請輸入貸款名稱");
    if (!Number.isFinite(principal) || principal <= 0) {
      return setError("貸款本金必須大於 0");
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return setError("年利率必須介於 0% 到 100%");
    }
    if (entryMode === "complete" && (!months || months <= 0)) {
      return setError("完整建立需要填寫還款期數");
    }
    if (months !== undefined && months <= 0) return setError("剩餘期數無效");
    if (grace !== undefined && grace < 0) return setError("寬限期無效");
    if (fees !== undefined && (!Number.isFinite(fees) || fees < 0)) {
      return setError("貸款費用無效");
    }
    if (
      !Number.isFinite(investmentPercent) ||
      investmentPercent < 0 ||
      investmentPercent > 100
    ) {
      return setError("投資用途比例必須介於 0% 到 100%");
    }
    if (purpose === "property" && !linkedHoldingId) {
      return setError("房產用途貸款需要選擇關聯房產");
    }
    if (accountLastFour && !/^\d{4}$/.test(accountLastFour)) {
      return setError("帳號末四碼需為 4 位數字");
    }

    onSave({
      name: name.trim(),
      ...(lender.trim() ? { lender: lender.trim() } : {}),
      loanType,
      purpose,
      investmentUsePercent:
        purpose === "investment"
          ? 100
          : purpose === "property" || purpose === "personal"
            ? 0
            : investmentPercent,
      ...(linkedHoldingId ? { linkedHoldingId } : {}),
      openingBalance: principal,
      trackingStartDate,
      ...(months ? { remainingTermMonths: months } : {}),
      ...(firstPaymentDate ? { firstPaymentDate } : {}),
      annualInterestRate: rate,
      rateType,
      repaymentMethod,
      ...(grace ? { gracePeriodMonths: grace } : {}),
      ...(entryMode === "complete"
        ? {
            originalPrincipal: principal,
            contractStartDate: trackingStartDate,
            originalTermMonths: months,
          }
        : {}),
      ...(fees !== undefined ? { initialFees: fees } : {}),
      ...(accountLastFour ? { accountLastFour } : {}),
      dataQuality:
        entryMode === "complete"
          ? "complete"
          : months
            ? "estimated"
            : "incomplete",
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-form-title"
    >
      <form
        onSubmit={handleSubmit}
        className="glass-card max-h-[92dvh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-b-none p-4 sm:rounded-2xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div>
          <p className="text-xs text-muted">第一階段 · 一般分期貸款</p>
          <h2 id="loan-form-title" className="mt-1 text-lg font-semibold">
            {loan ? "更正貸款資料" : "新增貸款"}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setEntryMode("complete")}
            className={entryMode === "complete" ? "btn-primary" : "btn-secondary"}
          >
            完整建立
          </button>
          <button
            type="button"
            onClick={() => setEntryMode("quick")}
            className={entryMode === "quick" ? "btn-primary" : "btn-secondary"}
          >
            既有貸款快速建立
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="貸款名稱" required>
            <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：國泰信貸 2025" />
          </Field>
          <Field label="銀行／貸款人（選填）">
            <input className="input-field" value={lender} onChange={(event) => setLender(event.target.value)} />
          </Field>
          <Field label="貸款類型" required>
            <select className="input-field" value={loanType} onChange={(event) => setLoanType(event.target.value as LoanType)}>
              {PHASE_ONE_TYPES.map((type) => <option key={type} value={type}>{LOAN_TYPE_LABELS[type]}</option>)}
            </select>
          </Field>
          <Field label="用途" required>
            <select className="input-field" value={purpose} onChange={(event) => handlePurposeChange(event.target.value as LoanPurpose)}>
              {PURPOSES.map((value) => <option key={value} value={value}>{LOAN_PURPOSE_LABELS[value]}</option>)}
            </select>
          </Field>
        </div>

        {purpose === "mixed" ? (
          <Field label="投資用途比例（%）" required>
            <input type="number" min="0" max="100" step="0.01" className="input-field" value={investmentUsePercent} onChange={(event) => setInvestmentUsePercent(event.target.value)} />
          </Field>
        ) : null}

        {purpose === "property" ? (
          <Field label="關聯房產" required>
            <select className="input-field" value={linkedHoldingId} onChange={(event) => setLinkedHoldingId(event.target.value)}>
              <option value="">請選擇房產</option>
              {propertyHoldings.map((holding) => <option key={holding.id} value={holding.id}>{holding.name}</option>)}
            </select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={entryMode === "complete" ? "原始貸款金額" : "目前剩餘本金"} required>
            <input type="number" min="0" step="1" className="input-field" value={balance} onChange={(event) => setBalance(event.target.value)} />
          </Field>
          <Field label={entryMode === "complete" ? "借款日期" : "本金基準日"} required>
            <DatePicker value={trackingStartDate} onChange={setTrackingStartDate} max={todayIsoDate()} />
          </Field>
          <Field label={entryMode === "complete" ? "還款期數（月）" : "剩餘期數（月，選填）"} required={entryMode === "complete"}>
            <input type="number" min="1" step="1" className="input-field" value={termMonths} onChange={(event) => setTermMonths(event.target.value)} />
          </Field>
          <Field label="首次／下次繳款日（選填）">
            <DatePicker value={firstPaymentDate} onChange={setFirstPaymentDate} min={trackingStartDate} />
          </Field>
          <Field label="年利率（%）" required>
            <input type="number" min="0" max="100" step="0.001" className="input-field" value={annualInterestRate} onChange={(event) => setAnnualInterestRate(event.target.value)} />
          </Field>
          <Field label="利率類型" required>
            <select className="input-field" value={rateType} onChange={(event) => setRateType(event.target.value as LoanRateType)}>
              <option value="fixed">固定利率</option>
              <option value="floating">機動利率</option>
            </select>
          </Field>
          <Field label="還款方式" required>
            <select className="input-field" value={repaymentMethod} onChange={(event) => setRepaymentMethod(event.target.value as LoanRepaymentMethod)}>
              {METHODS.map((method) => <option key={method} value={method}>{REPAYMENT_METHOD_LABELS[method]}</option>)}
            </select>
          </Field>
          <Field label="寬限期（月，選填）">
            <input type="number" min="0" step="1" className="input-field" value={gracePeriodMonths} onChange={(event) => setGracePeriodMonths(event.target.value)} />
          </Field>
          <Field label="開辦與一次性費用（選填）">
            <input type="number" min="0" step="1" className="input-field" value={initialFees} onChange={(event) => setInitialFees(event.target.value)} />
          </Field>
          <Field label="貸款帳號末四碼（選填）">
            <input inputMode="numeric" maxLength={4} className="input-field" value={accountLastFour} onChange={(event) => setAccountLastFour(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Field>
        </div>

        <p className="rounded-lg border border-border bg-surface-raised/60 p-3 text-xs leading-5 text-muted">
          本金還款只降低負債；利息與貸款費用才會進入融資成本。還款表採月利率預估，損益利息採實際天數／365 日；快速建立不回推未知歷史。
        </p>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn-primary">儲存貸款</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}{required ? " *" : ""}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
