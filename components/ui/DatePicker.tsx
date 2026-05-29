"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { zhTW } from "react-day-picker/locale";
import {
  formatIsoDateZh,
  parseIsoDate,
  toIsoDate,
} from "@/lib/date/iso-date";

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  id: idProp,
  className = "",
  placeholder = "選擇日期",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = parseIsoDate(value);
  const minDate = min ? parseIsoDate(min) : undefined;
  const maxDate = max ? parseIsoDate(max) : undefined;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const display = value ? formatIsoDateZh(value) : placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel ?? "選擇日期"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`input-field flex items-center justify-between gap-2 text-left ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${!value ? "text-muted" : ""}`}
      >
        <span className="tabular-nums">{display}</span>
        <CalendarIcon />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="日期選擇器"
          className="datepicker-popover fixed inset-x-4 bottom-4 z-50 rounded-xl border border-border bg-surface p-3 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:right-auto sm:top-full sm:mt-1"
          style={{
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <DayPicker
            mode="single"
            locale={zhTW}
            selected={selected}
            defaultMonth={selected ?? new Date()}
            onSelect={(date) => {
              if (!date) return;
              onChange(toIsoDate(date));
              setOpen(false);
            }}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            classNames={{
              root: "rdp-root",
              months: "rdp-months",
              month: "rdp-month",
              month_caption: "rdp-month-caption",
              nav: "rdp-nav",
              button_previous: "rdp-nav-btn",
              button_next: "rdp-nav-btn",
              weekdays: "rdp-weekdays",
              weekday: "rdp-weekday",
              week: "rdp-week",
              day: "rdp-day",
              day_button: "rdp-day-btn",
              selected: "rdp-selected",
              today: "rdp-today",
              outside: "rdp-outside",
              disabled: "rdp-disabled",
            }}
          />
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
