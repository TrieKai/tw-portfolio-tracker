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
  market?: StockMarket;
  /** 編輯時帶入既有名稱，代號未變前可先顯示 */
  initialName?: string;
  onResolved?: (name: string, normalizedSymbol: string) => void;
}

/**
 * 依代號向 API 查詢並顯示官方名稱（使用者不可手動輸入）
 */
export function ResolvedInstrumentName({
  assetType,
  symbol,
  market = "tse",
  initialName,
  onResolved,
}: ResolvedInstrumentNameProps) {
  const [name, setName] = useState(initialName ?? "");
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
      setStatus("idle");
      setError(null);
      return;
    }

    if (assetType === "stock" && !isValidStockSymbolInput(raw)) {
      setName("");
      setStatus("error");
      setError("代號格式無效");
      return;
    }

    if (assetType === "fund" && !/^\d+$/.test(raw.replace(/\D/g, ""))) {
      setName("");
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
        market: assetType === "stock" ? market : undefined,
      });

      if (cancelled) return;

      if (isLookupError(res)) {
        setName("");
        setStatus("error");
        setError(res.error);
        return;
      }

      setName(res.data.name);
      setStatus("ok");
      onResolvedRef.current?.(res.data.name, res.data.symbol);
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assetType, symbol, market]);

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
        <p className="mt-0.5 font-medium">{name}</p>
      </div>
    );
  }

  return null;
}

/** 供表單送出前強制查詢一次 */
export async function resolveInstrumentName(
  assetType: AssetType,
  symbol: string,
  market?: StockMarket
): Promise<{ ok: true; name: string; symbol: string } | { ok: false; error: string }> {
  const res = await lookupInstrument({
    assetType,
    symbol,
    market,
  });

  if (isLookupError(res)) {
    return { ok: false, error: res.error };
  }

  return {
    ok: true,
    name: res.data.name,
    symbol: res.data.symbol,
  };
}
