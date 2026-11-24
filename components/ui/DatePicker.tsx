"use client";

import { useId } from "react";

export function DatePicker({
  value,
  defaultValue,
  onChange,
  name,
  min,
  max,
  disabled,
  required,
  id: idProp,
  className = "",
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
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
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      min={min}
      max={max}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      className={`input-field tabular-nums ${className}`}
    />
  );
}
