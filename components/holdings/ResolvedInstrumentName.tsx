"use client";

import { useEffect, useRef, useState } from "react";
import {
  isLookupError,
  lookupInstrument,
} from "@/lib/client/instrument-api";
import type { AssetType, StockMarket } from "@/lib/types/holding";
import { isValidStockSymbolInput } from "@/lib/prices/stock-symbol";

interface ResolvedInstrumentNameProps {
  assetType: AssetType;
  symbol: string;
  /** 編輯時帶入既有名稱，代號未變前可先顯示 */
  initialName?: string;
  onResolved?: (
    name: string,
    normalizedSymbol: string,
    market?: StockMarket
  ) => void;
}

function getMarketLabel(market: StockMarket): string {
  return market === "otc" ? "上櫃" : "上市";
}

/**
 * 依代號向 API 查詢並顯示官方名稱（使用者不可手動輸入）
 */
export function ResolvedInstrumentName({
  assetType,
  symbol,
  initialName,
  onResolved,
}: ResolvedInstrumentNameProps) {
  const [name, setName] = useState(initialName ?? "");
  const [market, setMarket] = useState<StockMarket | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    initialName ? "ok" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    const raw = symbol.trim();
    if (!raw) {
      setName("");
      setMarket(null);
      setStatus("idle");
      setError(null);
      return;
    }

    if (assetType === "stock" && !isValidStockSymbolInput(raw)) {
      setName("");
      setMarket(null);
      setStatus("error");
      setError("代號格式無效");
      return;
    }

    if (assetType === "fund" && !/^\d+$/.test(raw.replace(/\D/g, ""))) {
      setName("");
      setMarket(null);
      setStatus("error");
      setError("基金代碼應為數字");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus("loading");
      setError(null);

      const res = await lookupInstrument({
        assetType,
        symbol: raw,
      });

      if (cancelled) return;

      if (isLookupError(res)) {
        setName("");
        setMarket(null);
        setStatus("error");
        setError(res.error);
        return;
      }

      setName(res.data.name);
      setMarket(res.data.market ?? null);
      setStatus("ok");
      onResolvedRef.current?.(
        res.data.name,
        res.data.symbol,
        res.data.market
      );
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assetType, symbol]);

  if (!symbol.trim()) {
    return (
      <p className="text-sm text-muted">輸入代號後將自動查詢名稱</p>
    );
  }

  if (status === "loading") {
    return <p className="text-sm text-muted">正在查詢名稱…</p>;
  }

  if (status === "error" && error) {
    return <p className="text-sm text-rose-500">{error}</p>;
  }

  if (status === "ok" && name) {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
        <p className="text-xs text-muted">名稱（自動帶入）</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <p className="font-medium">{name}</p>
          {market && (
            <span className="rounded bg-accent-dim px-1.5 py-0.5 text-xs text-accent">
              {getMarketLabel(market)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return null;
}

/** 供表單送出前強制查詢一次 */
export async function resolveInstrumentName(
  assetType: AssetType,
  symbol: string
): Promise<
  | { ok: true; name: string; symbol: string; market?: StockMarket }
  | { ok: false; error: string }
> {
  const res = await lookupInstrument({
    assetType,
    symbol,
  });

  if (isLookupError(res)) {
    return { ok: false, error: res.error };
  }

  return {
    ok: true,
    name: res.data.name,
    symbol: res.data.symbol,
    market: res.data.market,
  };
}
