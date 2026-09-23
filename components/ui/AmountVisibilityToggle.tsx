"use client";

import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";

export function AmountVisibilityToggle() {
  const { amountsHidden, toggleAmountsHidden } = useAmountPrivacy();
  const label = amountsHidden ? "顯示金額" : "隱藏金額";

  return (
    <button
      type="button"
      onClick={toggleAmountsHidden}
      className="btn-secondary touch-target gap-2 whitespace-nowrap"
      aria-label={label}
      aria-pressed={amountsHidden}
      title={label}
    >
      {amountsHidden ? <EyeOffIcon /> : <EyeIcon />}
      <span>{label}</span>
    </button>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 3.1-.5" />
      <path d="M9.9 9.9A2.75 2.75 0 0 0 14.1 14.1" />
    </svg>
  );
}
