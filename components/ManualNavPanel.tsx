"use client";

import { FormEvent, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { todayIsoDate } from "@/lib/date/iso-date";
import type { FundNavData } from "@/lib/fund-nav/types";
import type { ManualNavRecord } from "@/lib/client/types";

interface ManualNavPanelProps {
  /** 預填基金代碼（從查詢失敗帶入） */
  defaultFundCode?: string;
  defaultFundName?: string;
  onSave: (record: ManualNavRecord) => void;
  onCancel?: () => void;
}

export function ManualNavPanel({
  defaultFundCode = "",
  defaultFundName = "",
  onSave,
  onCancel,
}: ManualNavPanelProps) {
  const [fundCode, setFundCode] = useState(defaultFundCode);
  const [fundName, setFundName] = useState(defaultFundName);
  const [nav, setNav] = useState("");
  const [navDate, setNavDate] = useState(todayIsoDate);
  const [currency, setCurrency] = useState("TWD");
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsedNav = Number.parseFloat(nav);
    if (!fundCode.trim()) {
      setFormError("請輸入基金代碼");
      return;
    }
    if (!fundName.trim()) {
      setFormError("請輸入基金名稱");
      return;
    }
    if (Number.isNaN(parsedNav) || parsedNav <= 0) {
      setFormError("請輸入有效的淨值");
      return;
    }
    if (!navDate) {
      setFormError("請選擇淨值日期");
      return;
    }

    const record: ManualNavRecord = {
      fundCode: fundCode.trim(),
      fundName: fundName.trim(),
      nav: parsedNav,
      navDate,
      currency: currency.trim() || "TWD",
      isManual: true,
      savedAt: new Date().toISOString(),
    };

    onSave(record);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card space-y-4 border-amber-500/20 p-6"
    >
      <div>
        <h3 className="text-base font-semibold text-amber-200">手動輸入淨值</h3>
        <p className="mt-1 text-sm text-slate-500">
          自動抓取失敗時，可手動填寫並儲存至本機紀錄。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">基金代碼 *</span>
          <input
            type="text"
            inputMode="numeric"
            value={fundCode}
            onChange={(e) => setFundCode(e.target.value)}
            placeholder="18480065"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 text-slate-100 placeholder:text-slate-600 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm text-slate-400">基金名稱 *</span>
          <input
            type="text"
            value={fundName}
            onChange={(e) => setFundName(e.target.value)}
            placeholder="安聯台灣科技基金"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 text-slate-100 placeholder:text-slate-600 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">淨值 *</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={nav}
            onChange={(e) => setNav(e.target.value)}
            placeholder="759.20"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">淨值日期 *</span>
          <DatePicker
            value={navDate}
            onChange={setNavDate}
            max={todayIsoDate()}
            className="mt-0"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm text-slate-400">幣別</span>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 text-slate-100 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
          />
        </label>
      </div>

      {formError && (
        <p className="text-sm text-rose-400" role="alert">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-amber-500"
        >
          儲存手動淨值
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-surface-border px-5 py-2.5 text-sm text-slate-400 transition hover:bg-surface-border/50 hover:text-slate-200"
          >
            取消
          </button>
        )}
      </div>
    </form>
  );
}

/** 將 ManualNavRecord 轉成 NavResultCard 可用的 FundNavData */
export function manualRecordToNavData(record: ManualNavRecord): FundNavData {
  const { isManual: _m, savedAt: _s, ...data } = record;
  return data;
}
