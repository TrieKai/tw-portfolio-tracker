import type { FundNavData } from "@/lib/fund-nav/types";

interface NavResultCardProps {
  data: FundNavData;
  source?: "cache" | "fundclear" | "manual";
}

function formatNav(value: number): string {
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function changeColor(percent?: number): string {
  if (percent === undefined) return "text-slate-400";
  if (percent > 0) return "text-emerald-400";
  if (percent < 0) return "text-rose-400";
  return "text-slate-400";
}

export function NavResultCard({ data, source }: NavResultCardProps) {
  const sourceLabel =
    source === "manual"
      ? "手動輸入"
      : source === "cache"
        ? "快取"
        : source === "fundclear"
          ? "集保中心"
          : null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-surface-border bg-accent-dim px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-accent">
          最新淨值
        </p>
        <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-white">
          {formatNav(data.nav)}
          <span className="ml-2 text-lg font-normal text-slate-400">
            {data.currency}
          </span>
        </p>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div>
          <p className="text-sm text-slate-500">基金名稱</p>
          <p className="mt-0.5 text-lg font-medium text-slate-100">
            {data.fundName}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500">基金代碼</dt>
            <dd className="mt-0.5 font-mono text-slate-200">{data.fundCode}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">淨值日期</dt>
            <dd className="mt-0.5 text-slate-200">{data.navDate}</dd>
          </div>
          {data.navChangePercent !== undefined && (
            <div>
              <dt className="text-sm text-slate-500">漲跌幅</dt>
              <dd
                className={`mt-0.5 font-medium tabular-nums ${changeColor(data.navChangePercent)}`}
              >
                {data.navChangePercent > 0 ? "+" : ""}
                {data.navChangePercent}%
              </dd>
            </div>
          )}
          {data.previousNav !== undefined && (
            <div>
              <dt className="text-sm text-slate-500">前一日淨值</dt>
              <dd className="mt-0.5 tabular-nums text-slate-300">
                {formatNav(data.previousNav)}
              </dd>
            </div>
          )}
        </dl>

        {(sourceLabel || data.cached) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {sourceLabel && (
              <span className="rounded-full bg-surface-border px-3 py-1 text-xs text-slate-400">
                來源：{sourceLabel}
              </span>
            )}
            {data.cached && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-400/90">
                快取資料
                {data.cachedAt
                  ? ` · ${new Date(data.cachedAt).toLocaleString("zh-TW")}`
                  : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
