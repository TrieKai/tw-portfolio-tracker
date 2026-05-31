"use client";

import { useMemo, useState } from "react";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import {
  groupHoldingsWithMetrics,
  type HoldingGroupWithMetrics,
} from "@/lib/portfolio/holding-groups";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { EditHoldingModal } from "./EditHoldingModal";
import { HoldingsMobileList } from "./HoldingsMobileList";
import { HoldingLotDetailPanel } from "./HoldingLotActions";
import { ManualPriceModal } from "./ManualPriceModal";
import { SellHoldingModal } from "./SellHoldingModal";

type SortKey = "name" | "value" | "pnl" | "returnRate";

export function HoldingsTable({ holdings }: { holdings: HoldingWithMetrics[] }) {
  const { updateOne, edit, sell, remove, setManualPrice } = usePortfolio();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortAsc, setSortAsc] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [sellId, setSellId] = useState<string | null>(null);
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
      setSortAsc(false);
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
    if (h && confirm(`確定刪除 ${h.name}（${h.buyDate} 買入）？`)) remove(id);
  }

  const manualHolding = holdings.find((h) => h.id === manualId);
  const editHoldingRow = holdings.find((h) => h.id === editId);
  const sellHoldingRow = holdings.find((h) => h.id === sellId);

  const groupUpdating = (g: HoldingGroupWithMetrics) =>
    g.lots.some((l) => updatingId === l.id);

  if (holdings.length === 0) {
    return (
      <p className="text-center text-muted py-12">
        尚無持倉，請至「新增」建立第一筆
      </p>
    );
  }

  return (
    <>
      <div className="mb-4">
        <input
          type="search"
          placeholder="搜尋名稱或代號…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field w-full sm:max-w-xs"
        />
      </div>

      <HoldingsMobileList
        groups={filteredGroups}
        updatingId={updatingId}
        onRefresh={handleRefresh}
        onEdit={setEditId}
        onSell={setSellId}
        onManual={setManualId}
        onRemove={handleRemove}
        onRefreshGroup={handleRefreshGroup}
      />

      <div className="glass-card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="w-8 px-2 py-3" aria-label="展開" />
              <ThSort label="標的" active={sortKey === "name"} onClick={() => toggleSort("name")} />
              <th className="px-4 py-3">類型</th>
              <th className="px-4 py-3">均價 / 現價</th>
              <th className="px-4 py-3">數量</th>
              <ThSort label="市值" active={sortKey === "value"} onClick={() => toggleSort("value")} />
              <ThSort label="損益" active={sortKey === "pnl"} onClick={() => toggleSort("pnl")} />
              <ThSort label="報酬率" active={sortKey === "returnRate"} onClick={() => toggleSort("returnRate")} />
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
                  onManual={setManualId}
                  onRemove={handleRemove}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {editHoldingRow && (
        <EditHoldingModal
          holding={editHoldingRow}
          onSave={(input) => {
            edit(input);
            setEditId(null);
          }}
          onClose={() => setEditId(null)}
        />
      )}

      {sellHoldingRow && (
        <SellHoldingModal
          holding={sellHoldingRow}
          onSave={(input) => {
            sell(input);
            setSellId(null);
          }}
          onClose={() => setSellId(null)}
        />
      )}

      {manualHolding && (
        <ManualPriceModal
          symbol={manualHolding.symbol}
          name={manualHolding.name}
          defaultPrice={manualHolding.currentPrice}
          defaultDate={manualHolding.priceDate}
          onSave={(price, date) => {
            setManualPrice(manualHolding.id, price, date);
            setManualId(null);
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
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
}) {
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
          {g.assetType === "stock" ? "台股" : "基金"}
        </td>
        <td className="px-4 py-3 tabular-nums">
          <div>
            {g.isMerged ? "均價 " : ""}
            {formatCurrency(g.isMerged ? g.avgBuyPrice : lot.buyPrice)}
          </div>
          <div className="text-xs text-muted mt-0.5">
            現價{" "}
            {g.hasLivePrice ? formatCurrency(g.currentPrice!) : "—"}
          </div>
          {g.priceDate && (
            <div className="text-xs text-muted">{g.priceDate}</div>
          )}
        </td>
        <td className="px-4 py-3 tabular-nums">{g.quantity}</td>
        <td className="px-4 py-3 tabular-nums">
          {formatCurrency(g.marketValue)}
        </td>
        <td className={`px-4 py-3 tabular-nums ${pnlClass}`}>
          {g.hasLivePrice ? formatCurrency(g.pnl) : "—"}
        </td>
        <td className={`px-4 py-3 tabular-nums ${pnlClass}`}>
          {g.hasLivePrice ? formatPercent(g.returnRate) : "—"}
        </td>
        <td className="px-4 py-3">
          {g.isMerged ? (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                disabled={groupUpdating}
                onClick={onRefreshGroup}
                className="btn-secondary text-xs py-1 px-2"
              >
                {groupUpdating ? "…" : "全部更新"}
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
              lotName={g.name}
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
  lotName,
  updatingId,
  onRefresh,
  onEdit,
  onSell,
  onManual,
  onRemove,
}: {
  lotId: string;
  lotName: string;
  updatingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onSell: (id: string) => void;
  onManual: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        disabled={updatingId === lotId}
        onClick={() => onRefresh(lotId)}
        className="btn-secondary text-xs py-1 px-2"
      >
        {updatingId === lotId ? "…" : "更新"}
      </button>
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
        手動
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm(`確定刪除 ${lotName}？`)) onRemove(lotId);
        }}
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
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={onClick}
        className={`hover:text-foreground ${active ? "text-accent" : "text-muted"}`}
      >
        {label} {active ? "▼" : ""}
      </button>
    </th>
  );
}
