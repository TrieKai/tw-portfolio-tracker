"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchFundNav } from "@/lib/client/api";
import { loadManualHistory, saveManualRecord } from "@/lib/client/storage";
import type { FundNavData } from "@/lib/fund-nav/types";
import type { ManualNavRecord } from "@/lib/client/types";
import { isApiError } from "@/lib/client/types";
import { FundNavAppHeader } from "./FundNavAppHeader";
import { HistoryList } from "./HistoryList";
import { ManualNavPanel, manualRecordToNavData } from "./ManualNavPanel";
import { NavResultCard } from "./NavResultCard";

type ViewState = "idle" | "loading" | "success" | "error";

export function FundNavApp() {
  const [fundCode, setFundCode] = useState("");
  const [fundName, setFundName] = useState("");
  const [view, setView] = useState<ViewState>("idle");
  const [result, setResult] = useState<FundNavData | null>(null);
  const [source, setSource] = useState<"cache" | "fundclear" | "manual">(
    "fundclear"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorSuggestion, setErrorSuggestion] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [history, setHistory] = useState<ManualNavRecord[]>([]);

  useEffect(() => {
    setHistory(loadManualHistory());
  }, []);

  async function handleQuery(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setErrorSuggestion(null);
    setShowManual(false);

    const code = fundCode.trim();
    if (!code) {
      setErrorMessage("請輸入基金代碼");
      setView("error");
      return;
    }

    if (!/^\d+$/.test(code)) {
      setErrorMessage("基金代碼應為純數字，例如 18480065");
      setView("error");
      return;
    }

    setView("loading");

    try {
      const res = await fetchFundNav(code, fundName.trim() || undefined);

      if (isApiError(res)) {
        setErrorMessage(res.error);
        setErrorSuggestion(res.suggestion ?? null);
        setView("error");
        setShowManual(true);
        return;
      }

      setResult(res.data);
      setSource(res.source);
      setView("success");
    } catch {
      setErrorMessage("網路連線失敗，請稍後再試");
      setErrorSuggestion("自動抓取失敗，請改用手動輸入淨值與淨值日期。");
      setView("error");
      setShowManual(true);
    }
  }

  function handleManualSave(record: ManualNavRecord) {
    const next = saveManualRecord(record);
    setHistory(next);
    setResult(manualRecordToNavData(record));
    setSource("manual");
    setView("success");
    setShowManual(false);
    setErrorMessage(null);
    setFundCode(record.fundCode);
    setFundName(record.fundName);
  }

  function handleHistorySelect(record: ManualNavRecord) {
    setResult(manualRecordToNavData(record));
    setSource("manual");
    setView("success");
    setShowManual(false);
    setFundCode(record.fundCode);
    setFundName(record.fundName);
  }

  function handleClearHistory() {
    localStorage.removeItem("fund-nav-manual-history");
    setHistory([]);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6">
      <FundNavAppHeader />

      <form onSubmit={handleQuery} className="glass-card mt-8 space-y-5 p-6">
        <div>
          <label htmlFor="fundCode" className="mb-1.5 block text-sm text-slate-400">
            基金代碼 <span className="text-rose-400">*</span>
          </label>
          <input
            id="fundCode"
            type="text"
            inputMode="numeric"
            value={fundCode}
            onChange={(e) => setFundCode(e.target.value)}
            placeholder="18480065"
            disabled={view === "loading"}
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 font-mono text-slate-100 placeholder:text-slate-600 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
          />
          <p className="mt-1.5 text-xs text-slate-600">
            可至{" "}
            <a
              href="https://www.fundclear.com.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent/80 underline-offset-2 hover:text-accent hover:underline"
            >
              集保基金資訊觀測站
            </a>{" "}
            查詢代碼
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">
            基金名稱（選填）
          </span>
          <input
            type="text"
            value={fundName}
            onChange={(e) => setFundName(e.target.value)}
            placeholder="輔助比對用，通常僅需代碼"
            disabled={view === "loading"}
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 text-slate-100 placeholder:text-slate-600 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
          />
        </label>

        <button
          type="submit"
          disabled={view === "loading"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-surface transition hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-70"
        >
          {view === "loading" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface/30 border-t-surface" />
              查詢中…
            </>
          ) : (
            "查詢最新淨值"
          )}
        </button>
      </form>

      {view === "error" && errorMessage && (
        <div
          className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4"
          role="alert"
        >
          <p className="font-medium text-rose-300">{errorMessage}</p>
          {errorSuggestion && (
            <p className="mt-2 text-sm text-rose-200/70">{errorSuggestion}</p>
          )}
        </div>
      )}

      {view === "success" && result && (
        <div className="mt-6">
          <NavResultCard data={result} source={source} />
        </div>
      )}

      {showManual && (
        <div className="mt-6">
          <ManualNavPanel
            defaultFundCode={fundCode}
            defaultFundName={fundName || result?.fundName || ""}
            onSave={handleManualSave}
            onCancel={() => setShowManual(false)}
          />
        </div>
      )}

      {view === "idle" && !showManual && (
        <p className="mt-8 text-center text-sm text-slate-600">
          輸入基金代碼後即可從集保中心取得最新淨值
        </p>
      )}

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-sm text-slate-500 transition hover:text-slate-300"
        >
          {showManual ? "隱藏手動輸入" : "手動輸入淨值"}
        </button>
      </div>

      <div className="mt-4">
        <HistoryList
          items={history}
          onSelect={handleHistorySelect}
          onClear={handleClearHistory}
        />
      </div>
    </div>
  );
}
