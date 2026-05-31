"use client";

import { useId } from "react";

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  id: idProp,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <input
      type="date"
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel ?? "選擇日期"}
      className={`input-field tabular-nums ${className}`}
    />
  );
}
