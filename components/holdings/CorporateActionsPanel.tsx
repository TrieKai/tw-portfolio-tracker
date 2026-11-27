"use client";

import { formatQuantity } from "@/lib/portfolio/quantity";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { useMemo, useState, type FormEvent } from "react";
import { corporateActionLabel } from "@/lib/client/corporate-actions-api";
import { cashReturnPerShareBetween, cashReturnsOnPriceBasis, holdingActions } from "@/lib/corporate-actions/adjustment";
import { planManualCorporateAction } from "@/lib/corporate-actions/share-adjustment";
import { parseIsoDate, todayIsoDate } from "@/lib/date/iso-date";
import {
  groupHoldingsWithMetrics,
  holdingGroupKey,
} from "@/lib/portfolio/holding-groups";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";
import type {
  CorporateActionRecord,
  CorporateActionType,
  HoldingWithMetrics,
  ManualCorporateActionInput,
  PriceHistoryMap,
} from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";

type ManualActionType = ManualCorporateActionInput["actionType"];
type ManualGroupActionInput = Omit<ManualCorporateActionInput, "holdingId"> & {
  groupKey: string;
};
type ManualGroupActionForm = Omit<
  ManualGroupActionInput,
  "adjustmentRatio" | "cashReturnPerShare"
> & {
  adjustmentRatio: string;
  cashReturnPerShare: string;
};

interface SuspiciousPriceDrop {
  groupKey: string;
  name: string;
  symbol: string;
  lotCount: number;
  quantity: number;
  avgBuyPrice: number;
  previousDate: string;
  previousPrice: number;
  currentDate: string;
  currentPrice: number;
  hasCashReturn: boolean;
  dropRate: number;
  estimatedRatio: number;
}

const MANUAL_ACTION_LABELS: Record<ManualActionType, string> = {
  split: "股票分割",
  reverse_split: "反向分割",
  capital_reduction: "減資換股",
  share_exchange: "換股",
};

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${(value * 100).toFixed(4).replace(/\.?0+$/, "")}%`;
}

function formatMultiplier(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function eventDescription(event: CorporateActionEvent, formatAmount: (value: number) => string, formatQuoteAmount: (value: number, assetType: "stock") => string): string {
  const parts: string[] = [];
  if (event.stockDividendRatio > 0) {
    parts.push(`股票股利 ${formatRatio(event.stockDividendRatio)}`);
  }
  if (event.cashDividend !== undefined && event.cashDividend > 0) {
    parts.push(`現金股利 ${formatAmount(event.cashDividend)}/股`);
  }
  if (event.subscriptionRatio > 0) {
    const price =
      event.subscriptionPrice !== undefined
        ? `，認購價 ${formatQuoteAmount(event.subscriptionPrice, "stock")}`
        : "";
    parts.push(`現金增資配股率 ${formatRatio(event.subscriptionRatio)}${price}`);
  }
  return parts.join(" · ") || event.exDividendLabel || "公司行動";
}

function actionTypeLabel(type: CorporateActionType): string {
  if (type in MANUAL_ACTION_LABELS) {
    return MANUAL_ACTION_LABELS[type as ManualActionType];
  }
  switch (type) {
    case "stock_dividend":
      return "股票股利";
    case "cash_dividend":
      return "現金股利";
    case "rights_issue":
      return "現金增資";
    case "mixed":
      return "權息";
    case "manual_review":
      return "需確認";
    default:
      return "公司行動";
  }
}

function buildSuspiciousDrops(
  holdings: HoldingWithMetrics[],
  priceHistory: PriceHistoryMap,
  corporateActions: CorporateActionRecord[],
  threshold: number
): SuspiciousPriceDrop[] {
  const rowsByEvent = new Map<string, SuspiciousPriceDrop>();
  const groups = groupHoldingsWithMetrics(holdings).filter(
    (group) => group.assetType === "stock"
  );

  for (const group of groups) {
    const representative = [...group.lots].sort((a, b) => {
      const aCount = priceHistory[a.id]?.length ?? 0;
      const bCount = priceHistory[b.id]?.length ?? 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.buyDate.localeCompare(b.buyDate);
    })[0];
    if (!representative) continue;

    const points = [...(priceHistory[representative.id] ?? [])]
      .filter((point) => Number.isFinite(point.price) && point.price > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const cashReturns = cashReturnsOnPriceBasis(holdingActions(corporateActions, representative));

    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const returnedCash = cashReturnPerShareBetween(cashReturns, previous.date, current.date);
      const comparablePreviousPrice = previous.price - returnedCash;
      const dropRate = (comparablePreviousPrice - current.price) / previous.price;
      if (dropRate < threshold) continue;

      const affectedLots = group.lots.filter(
        (lot) => lot.buyDate < current.date
      );
      if (affectedLots.length === 0) continue;

      const affectedQuantity = affectedLots.reduce(
        (sum, lot) => sum + lot.quantity,
        0
      );
      const affectedCostBasis = affectedLots.reduce(
        (sum, lot) => sum + lot.costBasis,
        0
      );
      const key = `${group.groupKey}:${previous.date}:${current.date}`;
      rowsByEvent.set(key, {
        groupKey: group.groupKey,
        name: group.name,
        symbol: group.symbol,
        lotCount: affectedLots.length,
        quantity: affectedQuantity,
        avgBuyPrice:
          affectedQuantity > 0 ? affectedCostBasis / affectedQuantity : 0,
        previousDate: previous.date,
        previousPrice: previous.price,
        currentDate: current.date,
        currentPrice: current.price,
        hasCashReturn: returnedCash > 0,
        dropRate,
        estimatedRatio: comparablePreviousPrice / current.price,
      });
    }
  }

  return [...rowsByEvent.values()].sort((a, b) => b.dropRate - a.dropRate);
}

export function CorporateActionsPanel() {
  const today = todayIsoDate();
  const { formatAmount, formatQuoteAmount } = useAmountPrivacy();
  const {
    holdings,
    corporateActionStatus,
    corporateActionMessage,
    pendingCorporateActions,
    scanCorporateActions,
    applyDetectedCorporateActions,
    applyManualActionToGroup,
    storage,
  } = usePortfolio();

  const stockGroups = useMemo(
    () =>
      groupHoldingsWithMetrics(holdings).filter(
        (group) => group.assetType === "stock"
      ),
    [holdings]
  );
  const lotsById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding])),
    [holdings]
  );
  const [showManualForm, setShowManualForm] = useState(false);
  const [hideSuspiciousDrops, setHideSuspiciousDrops] = useState(false);
  const [form, setForm] = useState<ManualGroupActionForm>(() => ({
    groupKey: stockGroups[0]?.groupKey ?? "",
    actionType: "split",
    effectiveDate: today,
    adjustmentRatio: "2",
    cashReturnPerShare: "",
    note: "",
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [applyingEvent, setApplyingEvent] = useState<string | null>(null);

  const suspiciousDrops = useMemo(
    () => buildSuspiciousDrops(holdings, storage.priceHistory, storage.corporateActions, 0.3),
    [holdings, storage.priceHistory, storage.corporateActions]
  );
  const pendingCorporateActionGroups = useMemo(() => {
    const map = new Map<string, CorporateActionEvent[]>();
    for (const event of pendingCorporateActions) {
      const lot = lotsById.get(event.holdingId);
      const key = `${lot ? holdingGroupKey(lot) : event.holdingId}:${event.id}`;
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.values()];
  }, [pendingCorporateActions, lotsById]);
  const hasSuspiciousDrops = suspiciousDrops.length > 0;
  const showSuspiciousDrops = hasSuspiciousDrops && !hideSuspiciousDrops;

  const selectedGroup = stockGroups.find((group) => group.groupKey === form.groupKey);
  const parsedAdjustmentRatio = Number(form.adjustmentRatio);
  const parsedCashReturnPerShare =
    form.cashReturnPerShare.trim() === ""
      ? undefined
      : Number(form.cashReturnPerShare);
  const adjustment = {
    actionType: form.actionType,
    effectiveDate: form.effectiveDate,
    adjustmentRatio: parsedAdjustmentRatio,
    cashReturnPerShare: parsedCashReturnPerShare,
    note: form.note,
  };
  const validAdjustment = Number.isFinite(parsedAdjustmentRatio) && parsedAdjustmentRatio > 0 &&
    (parsedCashReturnPerShare === undefined || (Number.isFinite(parsedCashReturnPerShare) && parsedCashReturnPerShare >= 0)) &&
    !!parseIsoDate(form.effectiveDate) && form.effectiveDate <= today;
  const plans = showManualForm && selectedGroup && validAdjustment
    ? selectedGroup.lots.map((holding) => planManualCorporateAction(storage, holding, adjustment))
    : [];
  const readyPlans = plans.filter((plan) => plan?.status === "ready");
  const conflict = plans.find((plan) => plan?.status === "conflict");
  const previewError = conflict
    ? conflict.reason === "sale"
      ? "套用後換發股數不足以涵蓋已登錄的賣出。請核對生效日、倍率及賣出股數。"
      : "調整後的股數或金額超出可計算範圍。請核對倍率和退還現金。"
    : plans.length > 0 && !readyPlans.length
      ? "生效日前沒有可套用的買入批次，或這筆調整已登錄。"
      : null;
  const preview = readyPlans.reduce((total, plan) => ({
    quantityBefore: total.quantityBefore + plan.holding.quantity,
    quantityAfter: total.quantityAfter + plan.balance,
    totalCostBefore: total.totalCostBefore + plan.holding.buyPrice * plan.holding.quantity,
    totalCostAfter: total.totalCostAfter + plan.currentBuyPrice * plan.balance,
    cashReturn: total.cashReturn + plan.cashReturnTotal,
  }), { quantityBefore: 0, quantityAfter: 0, totalCostBefore: 0, totalCostAfter: 0, cashReturn: 0 });

  const handledCount = storage.corporateActions.length;
  const loading = corporateActionStatus === "loading";

  async function applyOfficialGroup(key: string, events: CorporateActionEvent[]) {
    setApplyingEvent(key);
    try {
      await applyDetectedCorporateActions(events);
    } finally {
      setApplyingEvent(null);
    }
  }

  function openManualForm(patch?: Partial<ManualGroupActionInput>) {
    setForm((prev) => ({
      ...prev,
      groupKey: patch?.groupKey ?? (stockGroups.some((group) => group.groupKey === prev.groupKey)
        ? prev.groupKey : stockGroups[0]?.groupKey ?? ""),
      actionType: patch?.actionType ?? prev.actionType,
      effectiveDate: patch?.effectiveDate ?? prev.effectiveDate,
      adjustmentRatio:
        patch?.adjustmentRatio !== undefined
          ? formatMultiplier(patch.adjustmentRatio)
          : prev.adjustmentRatio,
      cashReturnPerShare:
        patch?.cashReturnPerShare !== undefined
          ? formatMultiplier(patch.cashReturnPerShare)
          : prev.cashReturnPerShare,
      note: patch?.note ?? prev.note,
    }));
    setFormError(null);
    setShowManualForm(true);
  }

  async function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedGroup) {
      setFormError("請選擇標的");
      return;
    }
    if (
      !Number.isFinite(parsedAdjustmentRatio) ||
      parsedAdjustmentRatio <= 0
    ) {
      setFormError("調整倍率需大於 0");
      return;
    }
    if (
      parsedCashReturnPerShare !== undefined &&
      (!Number.isFinite(parsedCashReturnPerShare) ||
        parsedCashReturnPerShare < 0)
    ) {
      setFormError("每原股退還現金需大於或等於 0");
      return;
    }
    if (!parseIsoDate(form.effectiveDate) || form.effectiveDate > todayIsoDate()) {
      setFormError("請輸入今天或更早的有效生效日");
      return;
    }
    if (previewError) return;
    const saved = await applyManualActionToGroup(form.groupKey, adjustment);
    if (!saved) {
      setFormError("未能儲存公司行動，請確認持倉與瀏覽器儲存空間後重試。");
      return;
    }
    setShowManualForm(false);
    setFormError(null);
  }

  return (
    <section className="glass-card space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">公司行動</h2>
          <p className="text-sm text-muted">
            掃描官方除權息，或用異常價差輔助手動確認分割/減資換股。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void scanCorporateActions()}
            disabled={loading || applyingEvent !== null}
            className="btn-secondary w-full sm:w-auto"
          >
            {loading ? "掃描中…" : "掃描除權息"}
          </button>
          <button
            type="button"
            onClick={() => setHideSuspiciousDrops((v) => !v)}
            className="btn-secondary w-full sm:w-auto"
          >
            {showSuspiciousDrops ? "收合異常價差" : "查看異常價差"}
          </button>
          <button
            type="button"
            onClick={() => openManualForm()}
            className="btn-primary w-full sm:w-auto"
          >
            手動新增調整
          </button>
        </div>
      </div>

      {corporateActionMessage && (
        <p
          role="status"
          className={
            corporateActionStatus === "error"
              ? "text-sm text-rose-500"
              : "text-sm text-muted"
          }
        >
          {corporateActionMessage}
        </p>
      )}

      {showManualForm && (
        <form
          onSubmit={handleManualSubmit}
          className="rounded-lg border border-border/80 bg-surface px-3 py-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted">標的</span>
              <select
                value={form.groupKey}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, groupKey: e.target.value }))
                }
                className="input-field w-full"
              >
                <option value="">請選擇</option>
                {stockGroups.map((group) => (
                  <option key={group.groupKey} value={group.groupKey}>
                    {group.name}（{group.symbol}） · {group.market === "otc" ? "上櫃" : "上市"}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted">類型</span>
              <select
                value={form.actionType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    actionType: e.target.value as ManualActionType,
                  }))
                }
                className="input-field w-full"
              >
                {Object.entries(MANUAL_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted">生效日</span>
              <input
                type="date"
                max={today}
                required
                value={form.effectiveDate}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, effectiveDate: e.target.value }))
                }
                className="input-field w-full"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted">股數調整倍率</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                inputMode="decimal"
                value={form.adjustmentRatio}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    adjustmentRatio: e.target.value,
                  }))
                }
                className="input-field w-full"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted">每原股退還現金（選填）</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={form.cashReturnPerShare}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    cashReturnPerShare: e.target.value,
                  }))
                }
                className="input-field w-full"
                placeholder="例如 2"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted">備註</span>
              <input
                type="text"
                value={form.note ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, note: e.target.value }))
                }
                className="input-field w-full"
                placeholder="例如公告每 1000 股換發 800 股"
              />
            </label>
          </div>

          <div aria-live="polite">
            {previewError ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{previewError}</p> : readyPlans.length > 0 && (
              <div className="mt-3 space-y-1 text-sm text-muted tabular-nums">
                <p>
                  套用至 {readyPlans.length} 筆買入。剩餘股數{" "}
                  <span className="[overflow-wrap:anywhere]">{formatQuantity(preview.quantityBefore)} 股 → {formatQuantity(preview.quantityAfter)} 股</span>
                </p>
                <p>
                  剩餘成本 {formatAmount(preview.totalCostBefore)} → {formatAmount(preview.totalCostAfter)}
                  {preview.quantityAfter > 0 && `，均價 ${formatQuoteAmount(preview.totalCostBefore / preview.quantityBefore, "stock")} → ${formatQuoteAmount(preview.totalCostAfter / preview.quantityAfter, "stock")}`}
                </p>
                {preview.cashReturn > 0 && <p>預計退還股款 {formatAmount(preview.cashReturn)}</p>}
              </div>
            )}
          </div>

          {formError && <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{formError}</p>}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="btn-secondary"
            >
              取消
            </button>
            <button type="submit" disabled={!!previewError} className="btn-primary">
              套用調整
            </button>
          </div>
        </form>
      )}

      {hasSuspiciousDrops && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100">
          有 {suspiciousDrops.length} 筆價差待核對。判斷時會計入已登錄的退還股款。
        </div>
      )}

      {showSuspiciousDrops && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">疑似異常價差</h3>
            <p className="text-xs text-muted">相鄰價格下跌 30% 以上</p>
          </div>
          <ul className="space-y-3">
            {suspiciousDrops.map((row) => (
                <li
                  key={`${row.groupKey}:${row.previousDate}:${row.currentDate}`}
                className="rounded-lg border border-border/80 bg-surface px-3 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {row.name}（{row.symbol}）
                    </p>
                    <p className="mt-1 text-sm text-muted tabular-nums">
                      {row.previousDate}{" "}
                      {formatQuoteAmount(row.previousPrice, "stock")} →{" "}
                      {row.currentDate}{" "}
                      {formatQuoteAmount(row.currentPrice, "stock")}，{row.hasCashReturn ? "計入退還股款後下跌" : "下跌"}{" "}
                      {formatRatio(row.dropRate)}
                    </p>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {row.lotCount} 筆買入，合計 {formatQuantity(row.quantity)} 股；推估倍率約{" "}
                      {formatMultiplier(row.estimatedRatio)} 倍，僅供預填確認。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openManualForm({
                        groupKey: row.groupKey,
                        actionType: "split",
                        effectiveDate: row.currentDate,
                        adjustmentRatio: Number(row.estimatedRatio.toFixed(4)),
                        note: `由 ${row.previousDate} 至 ${row.currentDate} 價差預填，請確認公告比例。`,
                      })
                    }
                    className="btn-secondary text-sm"
                  >
                    預填調整
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingCorporateActionGroups.length > 0 ? (
        <ul className="space-y-3">
          {pendingCorporateActionGroups.map((events) => {
            const event = events[0];
            const lot = lotsById.get(event.holdingId);
            const groupKey = lot ? holdingGroupKey(lot) : event.holdingId;
            const eventKey = `${groupKey}:${event.id}`;
            const canApply =
              event.stockDividendRatio > 0 ||
              (event.cashDividend !== undefined && event.cashDividend > 0);
            const upcoming = event.effectiveDate > today;

            return (
              <li
                key={eventKey}
                className="rounded-lg border border-border/80 bg-surface px-3 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {event.name}（{event.symbol}） ·{" "}
                      {corporateActionLabel(event)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {event.effectiveDate} · {eventDescription(event, formatAmount, formatQuoteAmount)}
                    </p>
                    {lot && canApply && (
                      <p className="mt-1 text-xs text-muted">{events.length} 筆符合資格的買入 · 依生效日持股入帳</p>
                    )}
                    {!lot && (
                      <p className="mt-1 text-xs text-muted">已出清批次 · 依除息日持有的股數入帳</p>
                    )}
                    {event.note && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                        {event.note}
                      </p>
                    )}
                    {!canApply && (
                      <p className="mt-1 text-xs text-muted">
                        {event.subscriptionRatio > 0
                          ? "是否認購無法自動判斷；實際認購後請新增一筆持倉，認購本金會自動排除於損益。此處只標記已處理。"
                          : "此事件目前只標記已處理，不會改變股數與成本。"}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void applyOfficialGroup(eventKey, events)}
                    disabled={upcoming || loading || applyingEvent !== null}
                    className={
                      canApply && !upcoming ? "btn-primary text-sm" : "btn-secondary text-sm"
                    }
                  >
                    {upcoming ? "尚未生效" : applyingEvent === eventKey ? "套用中…" : canApply ? "套用全部" : "全部標記已處理"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          尚無待處理官方事件
          {handledCount > 0 ? `，已處理 ${handledCount} 筆。` : "。"}
        </p>
      )}

      {handledCount > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">
            查看已處理紀錄
          </summary>
          <ul className="mt-3 space-y-2">
            {[...storage.corporateActions].reverse().map((action) => (
              <li
                key={action.id}
                className="rounded-lg border border-border/70 bg-surface px-3 py-2"
              >
                <p className="font-medium">
                  {action.name}（{action.symbol}） ·{" "}
                  {actionTypeLabel(action.actionType)}
                </p>
                <p className="mt-1 text-xs text-muted tabular-nums">
                  {action.effectiveDate} · {formatQuantity(action.quantityBefore)} 股 →{" "}
                  {formatQuantity(action.quantityAfter)} 股，均價{" "}
                  {formatQuoteAmount(action.buyPriceBefore, "stock")} →{" "}
                  {formatQuoteAmount(action.buyPriceAfter, "stock")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
