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
  LoanCollateralPosition,
  LoanPurpose,
  LoanRateType,
  LoanRepaymentMethod,
  LoanType,
} from "@/lib/types/loan";

const LOAN_TYPE_OPTIONS: LoanType[] = [
  "personal_credit",
  "securities_margin",
  "securities_pledge",
  "mortgage",
  "home_equity",
  "policy",
  "revolving_credit",
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
const FLEXIBLE_METHODS: LoanRepaymentMethod[] = [
  "interest_only",
  "bullet",
  "revolving",
];
const REVOLVING_METHODS: LoanRepaymentMethod[] = ["revolving"];

type EntryMode = "complete" | "quick";

function isCollateralLoanType(type: LoanType): boolean {
  return type === "securities_margin" || type === "securities_pledge";
}

function isFlexibleLoanType(type: LoanType): boolean {
  return isCollateralLoanType(type) || type === "revolving_credit";
}

function initialRepaymentMethod(loan?: Loan): LoanRepaymentMethod {
  if (!loan) return "equal_payment";
  if (
    loan.loanType === "securities_margin" ||
    loan.loanType === "revolving_credit"
  ) {
    return "revolving";
  }
  if (
    loan.loanType === "securities_pledge" &&
    !FLEXIBLE_METHODS.includes(loan.repaymentMethod)
  ) {
    return "interest_only";
  }
  return loan.repaymentMethod;
}

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
    loan && isFlexibleLoanType(loan.loanType)
      ? "quick"
      : loan?.contractStartDate
        ? "complete"
        : "quick"
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
    useState<LoanRepaymentMethod>(initialRepaymentMethod(loan));
  const [gracePeriodMonths, setGracePeriodMonths] = useState(
    loan?.gracePeriodMonths ? String(loan.gracePeriodMonths) : ""
  );
  const [initialFees, setInitialFees] = useState(
    loan?.initialFees ? String(loan.initialFees) : ""
  );
  const [accountLastFour, setAccountLastFour] = useState(
    loan?.accountLastFour ?? ""
  );
  const [creditLimit, setCreditLimit] = useState(
    loan?.creditLimit ? String(loan.creditLimit) : ""
  );
  const [maturityDate, setMaturityDate] = useState(
    loan?.maturityDate ?? ""
  );
  const [maintenanceWarningPercent, setMaintenanceWarningPercent] = useState(
    loan?.maintenanceWarningPercent
      ? String(loan.maintenanceWarningPercent)
      : ""
  );
  const [maintenanceCallPercent, setMaintenanceCallPercent] = useState(
    loan?.maintenanceCallPercent ? String(loan.maintenanceCallPercent) : ""
  );
  const [manualCollateralValue, setManualCollateralValue] = useState(
    loan?.manualCollateralValue ? String(loan.manualCollateralValue) : ""
  );
  const [collateralQuantities, setCollateralQuantities] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      (loan?.collateralPositions ?? []).map((position) => [
        position.holdingId,
        String(position.quantity),
      ])
    )
  );
  const [error, setError] = useState<string | null>(null);

  const propertyHoldings = holdings.filter(
    (holding) => holding.assetType === "property"
  );
  const collateralHoldings = holdings.filter(
    (holding) => holding.assetType === "stock" || holding.assetType === "fund"
  );
  const collateralLoan = isCollateralLoanType(loanType);
  const flexibleLoan = isFlexibleLoanType(loanType);
  const availableMethods =
    loanType === "securities_margin" || loanType === "revolving_credit"
      ? REVOLVING_METHODS
      : flexibleLoan
        ? FLEXIBLE_METHODS
        : METHODS;

  function handleLoanTypeChange(next: LoanType) {
    setLoanType(next);
    if (next === "securities_margin") {
      setPurpose("investment");
      setInvestmentUsePercent("100");
      setRepaymentMethod("revolving");
      setEntryMode("quick");
    } else if (next === "securities_pledge") {
      setPurpose("investment");
      setInvestmentUsePercent("100");
      setRepaymentMethod("interest_only");
      setEntryMode("quick");
    } else if (next === "revolving_credit") {
      setRepaymentMethod("revolving");
      setEntryMode("quick");
    } else if (repaymentMethod === "revolving") {
      setRepaymentMethod("equal_payment");
    }
  }

  function toggleCollateral(holdingId: string, quantity: number) {
    setCollateralQuantities((current) => {
      if (holdingId in current) {
        const next = { ...current };
        delete next[holdingId];
        return next;
      }
      return { ...current, [holdingId]: String(quantity) };
    });
  }

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
    const limit = creditLimit.trim()
      ? Number.parseFloat(creditLimit)
      : undefined;
    const warningThreshold = maintenanceWarningPercent.trim()
      ? Number.parseFloat(maintenanceWarningPercent)
      : undefined;
    const callThreshold = maintenanceCallPercent.trim()
      ? Number.parseFloat(maintenanceCallPercent)
      : undefined;
    const manualCollateral = manualCollateralValue.trim()
      ? Number.parseFloat(manualCollateralValue)
      : undefined;
    const collateralPositions: LoanCollateralPosition[] = [];
    if (collateralLoan) {
      for (const [holdingId, rawQuantity] of Object.entries(
        collateralQuantities
      )) {
        const quantity = Number.parseFloat(rawQuantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return setError("擔保品數量必須大於 0");
        }
        const holding = collateralHoldings.find((item) => item.id === holdingId);
        if (holding && quantity > holding.quantity) {
          return setError(`${holding.name} 的擔保數量不可超過目前持有數量`);
        }
        collateralPositions.push({ holdingId, quantity });
      }
    }

    if (!name.trim()) return setError("請輸入貸款名稱");
    if (!Number.isFinite(principal) || principal <= 0) {
      return setError("貸款本金必須大於 0");
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return setError("年利率必須介於 0% 到 100%");
    }
    if (entryMode === "complete" && !flexibleLoan && (!months || months <= 0)) {
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
    if (flexibleLoan && limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      return setError("契約額度必須大於 0");
    }
    if (collateralLoan &&
      warningThreshold !== undefined &&
      (!Number.isFinite(warningThreshold) || warningThreshold <= 0)
    ) {
      return setError("提早警示維持率必須大於 0");
    }
    if (collateralLoan &&
      callThreshold !== undefined &&
      (!Number.isFinite(callThreshold) || callThreshold <= 0)
    ) {
      return setError("追繳維持率必須大於 0");
    }
    if (collateralLoan &&
      warningThreshold !== undefined &&
      callThreshold !== undefined &&
      callThreshold > warningThreshold
    ) {
      return setError("追繳維持率不可高於提早警示維持率");
    }
    if (collateralLoan &&
      manualCollateral !== undefined &&
      (!Number.isFinite(manualCollateral) || manualCollateral < 0)
    ) {
      return setError("外部擔保品市值無效");
    }

    const hasCollateralDefinition =
      collateralPositions.length > 0 || (manualCollateral ?? 0) > 0;
    const hasRiskThresholds =
      warningThreshold !== undefined && callThreshold !== undefined;
    const riskDataComplete =
      !collateralLoan || (hasCollateralDefinition && hasRiskThresholds);

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
      linkedHoldingId:
        purpose === "property" && linkedHoldingId
          ? linkedHoldingId
          : undefined,
      openingBalance: principal,
      trackingStartDate,
      remainingTermMonths:
        repaymentMethod === "revolving" ? undefined : months,
      firstPaymentDate:
        repaymentMethod === "revolving"
          ? undefined
          : firstPaymentDate || undefined,
      annualInterestRate: rate,
      rateType,
      repaymentMethod,
      gracePeriodMonths:
        repaymentMethod === "revolving" ? undefined : grace,
      originalPrincipal:
        entryMode === "complete" && !flexibleLoan ? principal : undefined,
      contractStartDate:
        entryMode === "complete" && !flexibleLoan
          ? trackingStartDate
          : undefined,
      originalTermMonths:
        entryMode === "complete" && !flexibleLoan ? months : undefined,
      initialFees: fees,
      accountLastFour: accountLastFour || undefined,
      creditLimit: flexibleLoan ? limit : undefined,
      maturityDate: flexibleLoan ? maturityDate || undefined : undefined,
      maintenanceWarningPercent: collateralLoan
        ? warningThreshold
        : undefined,
      maintenanceCallPercent: collateralLoan ? callThreshold : undefined,
      collateralPositions: collateralLoan ? collateralPositions : undefined,
      manualCollateralValue: collateralLoan ? manualCollateral : undefined,
      dataQuality:
        !riskDataComplete
          ? "incomplete"
          : entryMode === "complete" && !flexibleLoan
          ? "complete"
          : months || flexibleLoan
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
          <p className="text-xs text-muted">一般貸款、融資與質押</p>
          <h2 id="loan-form-title" className="mt-1 text-lg font-semibold">
            {loan ? "更正貸款資料" : "新增貸款"}
          </h2>
        </div>

        {!flexibleLoan ? <div className="grid grid-cols-2 gap-2">
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
        </div> : (
          <p className="rounded-lg border border-accent/30 bg-accent-dim p-3 text-sm text-muted">
            融資、質押與循環額度以目前動用本金為基準，不套用一般分期貸款的完整契約回推。
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="貸款名稱" required>
            <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：國泰信貸 2025" />
          </Field>
          <Field label="銀行／貸款人（選填）">
            <input className="input-field" value={lender} onChange={(event) => setLender(event.target.value)} />
          </Field>
          <Field label="貸款類型" required>
            <select className="input-field" value={loanType} onChange={(event) => handleLoanTypeChange(event.target.value as LoanType)}>
              {LOAN_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{LOAN_TYPE_LABELS[type]}</option>)}
            </select>
          </Field>
          <Field label="用途" required>
            <select className="input-field" value={purpose} disabled={loanType === "securities_margin"} onChange={(event) => handlePurposeChange(event.target.value as LoanPurpose)}>
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
          <Field label={entryMode === "complete" && !flexibleLoan ? "原始貸款金額" : flexibleLoan && loan ? "起始本金基準（更正用）" : "目前動用／剩餘本金"} required>
            <input type="number" min="0" step="1" className="input-field" value={balance} onChange={(event) => setBalance(event.target.value)} />
          </Field>
          <Field label={entryMode === "complete" && !flexibleLoan ? "借款日期" : "本金基準日"} required>
            <DatePicker value={trackingStartDate} onChange={setTrackingStartDate} max={todayIsoDate()} />
          </Field>
          {repaymentMethod !== "revolving" ? <Field label={entryMode === "complete" && !flexibleLoan ? "還款期數（月）" : "剩餘期數（月，選填）"} required={entryMode === "complete" && !flexibleLoan}>
            <input type="number" min="1" step="1" className="input-field" value={termMonths} onChange={(event) => setTermMonths(event.target.value)} />
          </Field> : null}
          {repaymentMethod !== "revolving" ? <Field label="首次／下次繳款日（選填）">
            <DatePicker value={firstPaymentDate} onChange={setFirstPaymentDate} min={trackingStartDate} />
          </Field> : null}
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
              {availableMethods.map((method) => <option key={method} value={method}>{REPAYMENT_METHOD_LABELS[method]}</option>)}
            </select>
          </Field>
          {repaymentMethod !== "revolving" ? <Field label="寬限期（月，選填）">
            <input type="number" min="0" step="1" className="input-field" value={gracePeriodMonths} onChange={(event) => setGracePeriodMonths(event.target.value)} />
          </Field> : null}
          <Field label="開辦與一次性費用（選填）">
            <input type="number" min="0" step="1" className="input-field" value={initialFees} onChange={(event) => setInitialFees(event.target.value)} />
          </Field>
          <Field label="貸款帳號末四碼（選填）">
            <input inputMode="numeric" maxLength={4} className="input-field" value={accountLastFour} onChange={(event) => setAccountLastFour(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Field>
        </div>

        {flexibleLoan ? (
          <section className="space-y-4 rounded-xl border border-border p-4">
            <div>
              <h3 className="font-medium">額度與到期資訊</h3>
              <p className="mt-1 text-xs text-muted">依銀行或券商契約填寫；不確定可先留白。</p>
              {loan ? <p className="mt-1 text-xs text-muted">目前動用本金請使用貸款卡片的「更新餘額」，才能保留歷史計息基準。</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="契約總額度（選填）">
                <input type="number" min="0" step="1" className="input-field" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} />
              </Field>
              <Field label="契約到期日（選填）">
                <DatePicker value={maturityDate} onChange={setMaturityDate} />
              </Field>
            </div>
          </section>
        ) : null}

        {collateralLoan ? (
          <section className="space-y-4 rounded-xl border border-border p-4">
            <div>
              <h3 className="font-medium">擔保品與維持率</h3>
              <p className="mt-1 text-xs text-muted">門檻請依你的券商或銀行契約輸入，系統不自行套用固定標準。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="提早警示維持率（%，選填）">
                <input type="number" min="0" step="0.01" className="input-field" value={maintenanceWarningPercent} onChange={(event) => setMaintenanceWarningPercent(event.target.value)} />
              </Field>
              <Field label="追繳維持率（%，選填）">
                <input type="number" min="0" step="0.01" className="input-field" value={maintenanceCallPercent} onChange={(event) => setMaintenanceCallPercent(event.target.value)} />
              </Field>
            </div>

            <div>
              <p className="text-sm text-muted">投資組合內擔保品</p>
              {collateralHoldings.length === 0 ? (
                <p className="mt-2 rounded-lg bg-surface-raised p-3 text-sm text-muted">目前沒有股票或基金持倉，可先填下方外部擔保品市值。</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {collateralHoldings.map((holding) => {
                    const selected = holding.id in collateralQuantities;
                    return (
                      <div key={holding.id} className="grid gap-2 rounded-lg bg-surface-raised p-3 sm:grid-cols-[1fr_160px] sm:items-center">
                        <label className="flex items-center gap-3 text-sm">
                          <input type="checkbox" checked={selected} onChange={() => toggleCollateral(holding.id, holding.quantity)} />
                          <span>{holding.name} · {holding.symbol || "無代號"}</span>
                        </label>
                        {selected ? (
                          <input aria-label={`${holding.name} 擔保數量`} type="number" min="0" step="0.0001" className="input-field" value={collateralQuantities[holding.id]} onChange={(event) => setCollateralQuantities((current) => ({ ...current, [holding.id]: event.target.value }))} />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Field label="其他／未追蹤擔保品目前市值（選填）">
              <input type="number" min="0" step="1" className="input-field" value={manualCollateralValue} onChange={(event) => setManualCollateralValue(event.target.value)} />
            </Field>
            <p className="text-xs text-muted">維持率＝擔保品目前市值 ÷ 目前本金。連結持倉缺少現價時會標示無法判斷，不會改用成本價。</p>
          </section>
        ) : null}

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
