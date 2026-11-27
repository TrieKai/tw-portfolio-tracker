"use client";

import { formatQuantity } from "@/lib/portfolio/quantity";
import { useMemo, useState } from "react";
import {
  formatPercent,
  formatQuotePrice,
} from "@/lib/portfolio/calculations";
import {
  getAssetTypeLabel,
  supportsAutoPriceUpdate,
} from "@/lib/portfolio/asset-labels";
import {
  groupHoldingsWithMetrics,
  holdingGroupKey,
  type HoldingGroupWithMetrics,
} from "@/lib/portfolio/holding-groups";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { EditHoldingModal } from "./EditHoldingModal";
import { HoldingsMobileList } from "./HoldingsMobileList";
import { HoldingLotDetailPanel } from "./HoldingLotActions";
import { ManualPriceModal } from "./ManualPriceModal";
import { SellGroupHoldingModal } from "./SellGroupHoldingModal";
import { SellHoldingModal } from "./SellHoldingModal";
import { useAmountPrivacy } from "@/providers/AmountPrivacyProvider";
import { EmptyState } from "@/components/ui/EmptyState";

type SortKey = "name" | "value" | "pnl" | "returnRate";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "value", label: "市值" },
  { value: "pnl", label: "損益" },
  { value: "returnRate", label: "報酬率" },
  { value: "name", label: "標的名稱" },
];

export function HoldingsTable({ holdings }: { holdings: HoldingWithMetrics[] }) {
  const { updateOne, edit, sell, remove, sales, setManualPrice } = usePortfolio();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortAsc, setSortAsc] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [sellId, setSellId] = useState<string | null>(null);
  const [sellGroupKey, setSellGroupKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = groupHoldingsWithMetrics(holdings);
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.symbol.toLowerCase().includes(q) ||
          g.lots.some(
            (l) =>
              l.name.toLowerCase().includes(q) ||
              l.symbol.toLowerCase().includes(q)
          )
      );
    }
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "zh-TW");
          break;
        case "value":
          cmp = a.marketValue - b.marketValue;
          break;
        case "pnl":
          cmp = a.pnl - b.pnl;
          break;
        case "returnRate":
          cmp = a.returnRate - b.returnRate;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [holdings, search, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  }

  function toggleExpanded(groupKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  async function handleRefresh(id: string) {
    setUpdatingId(id);
    await updateOne(id);
    setUpdatingId(null);
  }

  async function handleRefreshGroup(group: HoldingGroupWithMetrics) {
    for (const lot of group.lots) {
      setUpdatingId(lot.id);
      await updateOne(lot.id);
    }
    setUpdatingId(null);
  }

  function handleRemove(id: string) {
    const h = holdings.find((x) => x.id === id);
    if (h && confirm(`移除 ${h.name}（${h.buyDate} 買入）的持倉？已記錄的交易與損益歷史仍會保留。`)) remove(id);
  }

  const manualHolding = holdings.find((h) => h.id === manualId);
  const editHoldingRow = holdings.find((h) => h.id === editId);
  const sellHoldingRow = holdings.find((h) => h.id === sellId);
  const sellGroup = useMemo(() => {
    if (!sellGroupKey) return undefined;
    return groupHoldingsWithMetrics(holdings).find(
      (g) => g.groupKey === sellGroupKey
    );
  }, [holdings, sellGroupKey]);

  const groupUpdating = (g: HoldingGroupWithMetrics) =>
    g.lots.some((l) => updatingId === l.id);

  if (holdings.length === 0) {
    return (
      <EmptyState
        title="尚無持倉"
        description="新增一筆台股、境內基金或房產，或從資料備份匯入既有持倉。"
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="block w-full sm:max-w-xs">
          <span className="sr-only">搜尋持倉名稱或代號</span>
          <input
            type="search"
            placeholder="搜尋名稱或代號…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
          />
        </label>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
          <p role="status" className="shrink-0 text-sm text-muted sm:pb-2">{filteredGroups.length} 個標的</p>
          <div className="flex min-w-0 gap-2 md:hidden">
            <select
              aria-label="按欄位排序"
              className="input-field min-w-0"
              value={sortKey}
              onChange={(event) => {
                const option = SORT_OPTIONS.find(({ value }) => value === event.target.value);
                if (option) toggleSort(option.value);
              }}
            >
              {SORT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button
              type="button"
              className="btn-secondary shrink-0"
              aria-label={sortAsc ? "目前升冪，切換為降冪" : "目前降冪，切換為升冪"}
              onClick={() => setSortAsc(!sortAsc)}
            >
              {sortAsc ? "升冪" : "降冪"}
            </button>
          </div>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <EmptyState
          title="找不到符合的持倉"
          description="試試其他名稱或代號。"
          action={<button type="button" className="btn-secondary" onClick={() => setSearch("")}>清除搜尋</button>}
        />
      ) : (
        <>
          <HoldingsMobileList
            groups={filteredGroups}
            updatingId={updatingId}
            onRefresh={handleRefresh}
            onEdit={setEditId}
            onSell={setSellId}
            onSellGroup={setSellGroupKey}
            onManual={setManualId}
            onRemove={handleRemove}
            onRefreshGroup={handleRefreshGroup}
          />

          <div className="glass-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="w-8 px-2 py-3" aria-label="展開" />
                  <ThSort label="標的" active={sortKey === "name"} ascending={sortAsc} onClick={() => toggleSort("name")} />
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">均價 / 現價</th>
                  <th className="px-4 py-3">數量</th>
                  <ThSort label="市值" active={sortKey === "value"} ascending={sortAsc} onClick={() => toggleSort("value")} />
                  <ThSort label="損益" active={sortKey === "pnl"} ascending={sortAsc} onClick={() => toggleSort("pnl")} />
                  <ThSort label="報酬率" active={sortKey === "returnRate"} ascending={sortAsc} onClick={() => toggleSort("returnRate")} />
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((g) => {
                  const isOpen = g.isMerged && expanded.has(g.groupKey);
                  const pnlClass = g.pnl >= 0 ? "text-gain" : "text-loss";

                  return (
                    <GroupRows
                      key={g.groupKey}
                      g={g}
                      isOpen={isOpen}
                      pnlClass={pnlClass}
                      groupUpdating={groupUpdating(g)}
                      updatingId={updatingId}
                      onToggle={() => toggleExpanded(g.groupKey)}
                      onRefreshGroup={() => handleRefreshGroup(g)}
                      onRefresh={handleRefresh}
                      onEdit={setEditId}
                      onSell={setSellId}
                      onSellGroup={setSellGroupKey}
                      onManual={setManualId}
                      onRemove={handleRemove}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editHoldingRow && (
        <EditHoldingModal
          holding={editHoldingRow}
          firstSaleDate={sales.filter((sale) => sale.holdingId === editHoldingRow.id).map((sale) => sale.sellDate).sort()[0]}
          onSave={async (input, original) => {
            const saved = await edit(input, original);
            if (saved) {
              setEditId(null);
              if (holdingGroupKey(original) !== holdingGroupKey(input)) void updateOne(input.id);
            }
            return saved;
          }}
          onClose={() => setEditId(null)}
        />
      )}

      {sellHoldingRow && (
        <SellHoldingModal
          holding={sellHoldingRow}
          onSave={async (input) => {
            const saved = await sell(input);
            if (saved) setSellId(null);
            return saved;
          }}
          onClose={() => setSellId(null)}
        />
      )}

      {sellGroup && (
        <SellGroupHoldingModal
          group={sellGroup}
          onSave={async (inputs) => {
            const saved = await sell(inputs);
            if (saved) setSellGroupKey(null);
            return saved;
          }}
          onClose={() => setSellGroupKey(null)}
        />
      )}

      {manualHolding && (
        <ManualPriceModal
          key={holdingGroupKey(manualHolding)}
          symbol={manualHolding.symbol}
          name={manualHolding.name}
          assetType={manualHolding.assetType}
          defaultPrice={manualHolding.currentPrice}
          defaultDate={manualHolding.priceDate}
          onSave={async (price, date) => {
            const saved = await setManualPrice(manualHolding, price, date);
            if (saved) setManualId(null);
            return saved;
          }}
          onClose={() => setManualId(null)}
        />
      )}
    </>
  );
}

function GroupRows({
  g,
  isOpen,
  pnlClass,
  groupUpdating,
  updatingId,
  onToggle,
  onRefreshGroup,
  onRefresh,
  onEdit,
  onSell,
  onSellGroup,
  onManual,
  onRemove,
}: {
  g: HoldingGroupWithMetrics;
  isOpen: boolean;
  pnlClass: string;
  groupUpdating: boolean;
  updatingId: string | null;
  onToggle: () => void;
  onRefreshGroup: () => void;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onSell: (id: string) => void;
  onSellGroup: (groupKey: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { formatAmount, maskAmount } = useAmountPrivacy();
  const lot = g.lots[0];

  return (
    <>
      <tr className="border-b border-border/60 hover:bg-surface-raised/50">
        <td className="px-2 py-3 align-top">
          {g.isMerged ? (
            <button
              type="button"
              onClick={onToggle}
              className="text-muted hover:text-foreground px-1"
              aria-expanded={isOpen}
              title={isOpen ? "收合" : "展開買入明細"}
            >
              {isOpen ? "▼" : "▶"}
            </button>
          ) : null}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium">{g.name}</div>
          <div className="font-mono text-xs text-muted">
            {g.symbol}
            {g.market ? ` · ${g.market.toUpperCase()}` : ""}
          </div>
          {g.isMerged ? (
            <p className="mt-0.5 text-xs text-muted">{g.lots.length} 筆買入</p>
          ) : (
            <p className="mt-0.5 text-xs text-muted">買入 {lot.buyDate}</p>
          )}
          {g.lastError && (
            <p className="mt-1 text-xs text-rose-500">{g.lastError}</p>
          )}
        </td>
        <td className="px-4 py-3 text-muted">
          {getAssetTypeLabel(g.assetType)}
        </td>
        <td className="px-4 py-3 tabular-nums">
          <div>
            {g.isMerged ? "均價 " : ""}
            {maskAmount(formatQuotePrice(
              g.isMerged ? g.avgBuyPrice : lot.buyPrice,
              g.assetType
            ))}
          </div>
          <div className="text-xs text-muted mt-0.5">
            現價{" "}
            {g.hasLivePrice
              ? maskAmount(formatQuotePrice(g.currentPrice!, g.assetType))
              : "—"}
          </div>
          {g.priceDate && (
            <div className="text-xs text-muted">{g.priceDate}</div>
          )}
        </td>
        <td className="px-4 py-3 tabular-nums">{formatQuantity(g.quantity)}</td>
        <td className="px-4 py-3 tabular-nums">
          {formatAmount(g.marketValue)}
        </td>
        <td className={`px-4 py-3 tabular-nums ${pnlClass}`}>
          {g.hasLivePrice ? formatAmount(g.pnl) : "—"}
        </td>
        <td className={`px-4 py-3 tabular-nums ${pnlClass}`}>
          {g.hasLivePrice ? formatPercent(g.returnRate) : "—"}
        </td>
        <td className="px-4 py-3">
          {g.isMerged ? (
            <div className="flex flex-wrap gap-1">
              {g.lots.some((l) => supportsAutoPriceUpdate(l.assetType)) && (
                <button
                  type="button"
                  disabled={groupUpdating}
                  onClick={onRefreshGroup}
                  className="btn-secondary text-xs py-1 px-2"
                >
                  {groupUpdating ? "…" : "全部更新"}
                </button>
              )}
              <button
                type="button"
                onClick={() => onSellGroup(g.groupKey)}
                className="btn-secondary text-xs py-1 px-2"
              >
                賣出
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="btn-secondary text-xs py-1 px-2"
              >
                {isOpen ? "收合" : "明細"}
              </button>
            </div>
          ) : (
            <LotActionButtons
              lotId={lot.id}
              assetType={lot.assetType}
              updatingId={updatingId}
              onRefresh={onRefresh}
              onEdit={onEdit}
              onSell={onSell}
              onManual={onManual}
              onRemove={onRemove}
            />
          )}
        </td>
      </tr>
      {isOpen &&
        g.lots.map((lot) => (
          <tr
            key={lot.id}
            className="border-b border-border/40 bg-surface-raised/30"
          >
            <td />
            <td colSpan={8} className="px-4 py-2">
              <HoldingLotDetailPanel
                lot={lot}
                updatingId={updatingId}
                onRefresh={onRefresh}
                onEdit={onEdit}
                onSell={onSell}
                onManual={onManual}
                onRemove={onRemove}
              />
            </td>
          </tr>
        ))}
    </>
  );
}

function LotActionButtons({
  lotId,
  assetType,
  updatingId,
  onRefresh,
  onEdit,
  onSell,
  onManual,
  onRemove,
}: {
  lotId: string;
  assetType: HoldingWithMetrics["assetType"];
  updatingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onSell: (id: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {supportsAutoPriceUpdate(assetType) && (
        <button
          type="button"
          disabled={updatingId === lotId}
          onClick={() => onRefresh(lotId)}
          className="btn-secondary text-xs py-1 px-2"
        >
          {updatingId === lotId ? "…" : "更新"}
        </button>
      )}
      <button
        type="button"
        onClick={() => onEdit(lotId)}
        className="btn-secondary text-xs py-1 px-2"
      >
        編輯
      </button>
      <button
        type="button"
        onClick={() => onSell(lotId)}
        className="btn-secondary text-xs py-1 px-2"
      >
        賣出
      </button>
      <button
        type="button"
        onClick={() => onManual(lotId)}
        className="btn-secondary text-xs py-1 px-2"
      >
        {assetType === "property" ? "估價" : "手動"}
      </button>
      <button
        type="button"
        onClick={() => onRemove(lotId)}
        className="text-xs text-rose-500 hover:underline px-2"
      >
        刪除
      </button>
    </div>
  );
}

function ThSort({
  label,
  active,
  ascending,
  onClick,
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
}) {
  return (
    <th className="whitespace-nowrap px-4 py-3" aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`hover:text-foreground ${active ? "text-accent" : "text-muted"}`}
      >
        {label}
        {active && (
          <svg aria-hidden="true" viewBox="0 0 16 16" className={`ml-1 inline size-3 ${ascending ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        )}
      </button>
    </th>
  );
}
