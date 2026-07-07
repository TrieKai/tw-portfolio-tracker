"use client";

import { useMemo, useState, type FormEvent } from "react";
import { corporateActionLabel } from "@/lib/client/corporate-actions-api";
import {
  formatCurrency,
  formatQuotePrice,
} from "@/lib/portfolio/calculations";
import {
  groupHoldingsWithMetrics,
  holdingGroupKey,
} from "@/lib/portfolio/holding-groups";
import type { CorporateActionEvent } from "@/lib/corporate-actions/types";
import type {
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

function eventDescription(event: CorporateActionEvent): string {
  const parts: string[] = [];
  if (event.stockDividendRatio > 0) {
    parts.push(`股票股利 ${formatRatio(event.stockDividendRatio)}`);
  }
  if (event.cashDividend !== undefined && event.cashDividend > 0) {
    parts.push(`現金股利 ${formatCurrency(event.cashDividend)}/股`);
  }
  if (event.subscriptionRatio > 0) {
    const price =
      event.subscriptionPrice !== undefined
        ? `，認購價 ${formatQuotePrice(event.subscriptionPrice, "stock")}`
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

    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const dropRate = (previous.price - current.price) / previous.price;
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
        dropRate,
        estimatedRatio: previous.price / current.price,
      });
    }
  }

  return [...rowsByEvent.values()].sort((a, b) => b.dropRate - a.dropRate);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CorporateActionsPanel() {
  const {
    holdings,
    corporateActionStatus,
    corporateActionMessage,
    pendingCorporateActions,
    scanCorporateActions,
    applyDetectedCorporateAction,
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
    effectiveDate: todayIso(),
    adjustmentRatio: "2",
    cashReturnPerShare: "",
    note: "",
  }));
  const [formError, setFormError] = useState<string | null>(null);

  const suspiciousDrops = useMemo(
    () => buildSuspiciousDrops(holdings, storage.priceHistory, 0.3),
    [holdings, storage.priceHistory]
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
  const cashReturnPerShare =
    parsedCashReturnPerShare !== undefined &&
    Number.isFinite(parsedCashReturnPerShare) &&
    parsedCashReturnPerShare > 0
      ? parsedCashReturnPerShare
      : 0;
  const preview =
    selectedGroup && parsedAdjustmentRatio > 0
      ? {
          quantityAfter: selectedGroup.quantity * parsedAdjustmentRatio,
          totalCostBefore: selectedGroup.costBasis,
          totalCostAfter: Math.max(
            selectedGroup.costBasis -
              selectedGroup.quantity * cashReturnPerShare,
            0
          ),
        }
      : null;
  const previewBuyPrice =
    preview && preview.quantityAfter > 0
      ? preview.totalCostAfter / preview.quantityAfter
      : null;

  const handledCount = storage.corporateActions.length;
  const loading = corporateActionStatus === "loading";

  function openManualForm(patch?: Partial<ManualGroupActionInput>) {
    setForm((prev) => ({
      ...prev,
      groupKey: patch?.groupKey ?? prev.groupKey ?? stockGroups[0]?.groupKey ?? "",
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

  function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.groupKey) {
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
      setFormError("請輸入有效生效日");
      return;
    }
    applyManualActionToGroup(form.groupKey, {
      actionType: form.actionType,
      effectiveDate: form.effectiveDate,
      adjustmentRatio: parsedAdjustmentRatio,
      cashReturnPerShare: parsedCashReturnPerShare,
      note: form.note,
    });
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
            disabled={loading}
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
                    {group.name}（{group.symbol}）· {group.lots.length} 筆 · 合計{" "}
                    {formatMultiplier(group.quantity)} 股
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

          {preview && selectedGroup && (
            <p className="mt-3 text-sm text-muted tabular-nums">
              預覽：{formatMultiplier(selectedGroup.quantity)} 股 →{" "}
              {formatMultiplier(preview.quantityAfter)} 股，均價{" "}
              {formatQuotePrice(selectedGroup.avgBuyPrice, "stock")} →{" "}
              {previewBuyPrice !== null
                ? formatQuotePrice(previewBuyPrice, "stock")
                : "-"}
              ，成本 {formatCurrency(preview.totalCostBefore)} →{" "}
              {formatCurrency(preview.totalCostAfter)}
              {selectedGroup.lots.length > 1 ? `（套用至 ${selectedGroup.lots.length} 筆買入）` : ""}
            </p>
          )}

          {formError && <p className="mt-2 text-sm text-rose-500">{formError}</p>}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="btn-secondary"
            >
              取消
            </button>
            <button type="submit" className="btn-primary">
              套用調整
            </button>
          </div>
        </form>
      )}

      {hasSuspiciousDrops && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-100">
          已自動偵測到 {suspiciousDrops.length} 筆相鄰價格下跌超過 30% 的紀錄，
          可能是分割、減資換股、除權息或單純行情大跌。
        </div>
      )}

      {showSuspiciousDrops && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">疑似異常價差</h3>
            <p className="text-xs text-muted">門檻：相鄰價格下跌 30% 以上</p>
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
                      {formatQuotePrice(row.previousPrice, "stock")} →{" "}
                      {row.currentDate}{" "}
                      {formatQuotePrice(row.currentPrice, "stock")}，下跌{" "}
                      {formatRatio(row.dropRate)}
                    </p>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {row.lotCount} 筆買入，合計 {formatMultiplier(row.quantity)} 股；推估倍率約{" "}
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
            const group = stockGroups.find((item) => item.groupKey === groupKey);
            const canApply = event.stockDividendRatio > 0;

            return (
              <li
                key={`${groupKey}:${event.id}`}
                className="rounded-lg border border-border/80 bg-surface px-3 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {event.name}（{event.symbol}） ·{" "}
                      {corporateActionLabel(event)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {event.effectiveDate} · {eventDescription(event)}
                    </p>
                    {lot && (
                      <p className="mt-1 text-xs text-muted tabular-nums">
                        {group?.lots.length ?? events.length} 筆買入 · 合計{" "}
                        {formatMultiplier(group?.quantity ?? lot.quantity)} 股 · 均價{" "}
                        {formatQuotePrice(group?.avgBuyPrice ?? lot.buyPrice, "stock")}
                      </p>
                    )}
                    {event.note && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                        {event.note}
                      </p>
                    )}
                    {!canApply && (
                      <p className="mt-1 text-xs text-muted">
                        此事件目前僅記錄處理，不會改變股數與成本。
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => events.forEach(applyDetectedCorporateAction)}
                    className={
                      canApply ? "btn-primary text-sm" : "btn-secondary text-sm"
                    }
                  >
                    {canApply ? "套用全部" : "全部標記已處理"}
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
                  {action.effectiveDate} · {formatMultiplier(action.quantityBefore)} 股 →{" "}
                  {formatMultiplier(action.quantityAfter)} 股，均價{" "}
                  {formatQuotePrice(action.buyPriceBefore, "stock")} →{" "}
                  {formatQuotePrice(action.buyPriceAfter, "stock")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
