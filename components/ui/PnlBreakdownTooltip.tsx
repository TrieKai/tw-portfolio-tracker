"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/lib/portfolio/calculations";
import type { PnlBreakdown, PeriodPnlBreakdown } from "@/lib/portfolio/pnl-breakdown";

const VIEWPORT_MARGIN = 12;
const GAP = 8;
const TOOLTIP_Z_INDEX = 9999;

type Placement = "top" | "bottom";

function amountClass(amount: number): string {
  if (amount > 0) return "text-gain";
  if (amount < 0) return "text-loss";
  return "text-muted";
}

function BreakdownPanel({
  id,
  title,
  subtitle,
  breakdown,
  total,
  style,
  panelRef,
}: {
  id: string;
  title: string;
  subtitle?: string;
  breakdown: Pick<PnlBreakdown, "byAssetType" | "byHolding">;
  total: number;
  style: CSSProperties;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      style={style}
      className="w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-[var(--tooltip-bg)] p-3 text-left text-xs leading-relaxed text-foreground shadow-xl"
    >
      <span className="mb-1 block font-medium">{title}</span>
      {subtitle && (
        <span className="mb-2 block text-[10px] text-muted">{subtitle}</span>
      )}

      {breakdown.byAssetType.length > 0 && (
        <span className="mb-2 block space-y-1 border-b border-border/60 pb-2">
          {breakdown.byAssetType.map((row) => (
            <span key={row.assetType} className="flex justify-between gap-3">
              <span className="text-muted">{row.label}</span>
              <span
                className={`tabular-nums font-medium ${amountClass(row.amount)}`}
              >
                {formatCurrency(row.amount)}
              </span>
            </span>
          ))}
        </span>
      )}

      {breakdown.byHolding.length > 0 ? (
        <span className="block max-h-48 space-y-1 overflow-y-auto">
          {breakdown.byHolding.map((row) => (
            <span key={row.groupKey} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-muted" title={row.name}>
                {row.symbol ? `${row.symbol} ` : ""}
                {row.name}
              </span>
              <span
                className={`shrink-0 tabular-nums ${amountClass(row.amount)}`}
              >
                {formatCurrency(row.amount)}
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span className="block text-muted">尚無可分項資料</span>
      )}

      <span className="mt-2 flex justify-between gap-3 border-t border-border/60 pt-2 font-medium">
        <span>合計</span>
        <span className={`tabular-nums ${amountClass(total)}`}>
          {formatCurrency(total)}
        </span>
      </span>
    </div>
  );
}

function computeTooltipPosition(
  trigger: HTMLElement,
  panel: HTMLElement
): { top: number; left: number; placement: Placement } {
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const spaceBelow = viewportH - triggerRect.bottom - VIEWPORT_MARGIN;

  let placement: Placement = "top";
  if (panelRect.height + GAP > spaceAbove && spaceBelow >= spaceAbove) {
    placement = "bottom";
  } else if (
    panelRect.height + GAP > spaceBelow &&
    spaceAbove > spaceBelow
  ) {
    placement = "top";
  }

  let top =
    placement === "top"
      ? triggerRect.top - panelRect.height - GAP
      : triggerRect.bottom + GAP;

  let left = triggerRect.left;

  if (left + panelRect.width > viewportW - VIEWPORT_MARGIN) {
    left = viewportW - VIEWPORT_MARGIN - panelRect.width;
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  if (top < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN;
  }
  if (top + panelRect.height > viewportH - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, viewportH - VIEWPORT_MARGIN - panelRect.height);
  }

  return { top, left, placement };
}

export function PnlValueWithBreakdown({
  value,
  valueClassName = "",
  breakdown,
  periodBreakdown,
  title,
}: {
  value: string;
  valueClassName?: string;
  breakdown?: PnlBreakdown;
  periodBreakdown?: PeriodPnlBreakdown | null;
  title: string;
}) {
  const data = periodBreakdown ?? breakdown;
  const total = periodBreakdown?.total ?? breakdown?.total;
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const next = computeTooltipPosition(trigger, panel);
    setCoords({ top: next.top, left: next.left });
    setPositioned(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPositioned(false);
      return;
    }

    updatePosition();
  }, [open, data, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePosition]);

  if (!data || total === undefined || value === "—") {
    return <span className={`tabular-nums ${valueClassName}`}>{value}</span>;
  }

  const subtitle = periodBreakdown
    ? `${periodBreakdown.startDate} → ${periodBreakdown.endDate}`
    : undefined;

  const panelStyle: CSSProperties = {
    position: "fixed",
    top: coords.top,
    left: coords.left,
    zIndex: TOOLTIP_Z_INDEX,
    visibility: positioned ? "visible" : "hidden",
    pointerEvents: "none",
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cursor-help border-b border-dotted border-current/40 tabular-nums ${valueClassName}`}
        aria-label={`${title}分項明細`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {value}
      </button>

      {mounted &&
        open &&
        createPortal(
          <BreakdownPanel
            id={tooltipId}
            title={title}
            subtitle={subtitle}
            breakdown={data}
            total={total}
            panelRef={panelRef}
            style={panelStyle}
          />,
          document.body
        )}
    </>
  );
}
