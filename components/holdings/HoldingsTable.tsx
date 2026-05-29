"use client";

import { useMemo, useState } from "react";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/portfolio/calculations";
import type { HoldingWithMetrics } from "@/lib/types/holding";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { EditHoldingModal } from "./EditHoldingModal";
import { HoldingsMobileList } from "./HoldingsMobileList";
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = holdings;
    if (q) {
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.symbol.toLowerCase().includes(q)
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

  async function handleRefresh(id: string) {
    setUpdatingId(id);
    await updateOne(id);
    setUpdatingId(null);
  }

  const manualHolding = holdings.find((h) => h.id === manualId);
  const editHoldingRow = holdings.find((h) => h.id === editId);
  const sellHoldingRow = holdings.find((h) => h.id === sellId);

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
        holdings={filtered}
        updatingId={updatingId}
        onRefresh={handleRefresh}
        onEdit={setEditId}
        onSell={setSellId}
        onManual={setManualId}
        onRemove={(id) => {
          const h = holdings.find((x) => x.id === id);
          if (h && confirm(`確定刪除 ${h.name}？`)) remove(id);
        }}
      />

      <div className="glass-card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <ThSort label="標的" active={sortKey === "name"} onClick={() => toggleSort("name")} />
              <th className="px-4 py-3">類型</th>
              <th className="px-4 py-3">現價</th>
              <ThSort label="市值" active={sortKey === "value"} onClick={() => toggleSort("value")} />
              <ThSort label="損益" active={sortKey === "pnl"} onClick={() => toggleSort("pnl")} />
              <ThSort label="報酬率" active={sortKey === "returnRate"} onClick={() => toggleSort("returnRate")} />
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <tr key={h.id} className="border-b border-border/60 hover:bg-surface-raised/50">
                <td className="px-4 py-3">
                  <div className="font-medium">{h.name}</div>
                  <div className="font-mono text-xs text-muted">
                    {h.symbol}
                    {h.market ? ` · ${h.market.toUpperCase()}` : ""}
                  </div>
                  {h.lastError && (
                    <p className="mt-1 text-xs text-rose-500">{h.lastError}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">
                  {h.assetType === "stock" ? "台股" : "基金"}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {h.hasLivePrice
                    ? formatCurrency(h.currentPrice!)
                    : "—"}
                  {h.priceDate && (
                    <div className="text-xs text-muted">{h.priceDate}</div>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatCurrency(h.marketValue)}
                </td>
                <td
                  className={`px-4 py-3 tabular-nums ${
                    h.pnl >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {h.hasLivePrice ? formatCurrency(h.pnl) : "—"}
                </td>
                <td
                  className={`px-4 py-3 tabular-nums ${
                    h.returnRate >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {h.hasLivePrice ? formatPercent(h.returnRate) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={updatingId === h.id}
                      onClick={() => handleRefresh(h.id)}
                      className="btn-secondary text-xs py-1 px-2"
                    >
                      {updatingId === h.id ? "…" : "更新"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(h.id)}
                      className="btn-secondary text-xs py-1 px-2"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={() => setSellId(h.id)}
                      className="btn-secondary text-xs py-1 px-2"
                    >
                      賣出
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualId(h.id)}
                      className="btn-secondary text-xs py-1 px-2"
                    >
                      手動
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`確定刪除 ${h.name}？`)) remove(h.id);
                      }}
                      className="text-xs text-rose-500 hover:underline px-2"
                    >
                      刪除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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
