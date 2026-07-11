import type { PortfolioHealth } from "@/lib/portfolio/health";
import type { InvestmentWeather } from "@/lib/portfolio/weather";

export function PortfolioInsights({
  health,
  weather,
}: {
  health: PortfolioHealth;
  weather: InvestmentWeather;
}) {
  const scoreTone = health.level === "excellent" || health.level === "good"
    ? "text-gain"
    : health.level === "watch"
      ? "text-amber-600 dark:text-amber-400"
      : health.level === "empty"
        ? "text-muted"
        : "text-loss";

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <article className="glass-card overflow-hidden p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted">投資天氣</p>
            <h2 className="mt-2 text-xl font-semibold">{weather.title}</h2>
          </div>
          <span className="select-none text-5xl leading-none" role="img" aria-label={weather.title}>
            {weather.icon}
          </span>
        </div>
        <p className="mt-5 text-sm leading-6">{weather.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {weather.changeRate !== null && (
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${weather.changeRate >= 0 ? "bg-emerald-500/10 text-gain" : "bg-rose-500/10 text-loss"}`}>
              {weather.changeRate > 0 ? "+" : ""}{weather.changeRate.toFixed(2)}%
            </span>
          )}
          {weather.note && <span className="text-xs text-muted">{weather.note}</span>}
        </div>
      </article>

      <article className="glass-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted">投資健康分數</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-4xl font-bold tabular-nums ${scoreTone}`}>{health.score}</span>
              <span className="text-sm text-muted">/ 100</span>
              <span className="ml-1 text-sm font-medium">{health.label}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{health.summary}</p>
          </div>
          {health.suggestions[0] && (
            <p className="max-w-sm rounded-xl bg-surface-raised/80 px-3 py-2 text-xs leading-5 text-muted">
              {health.suggestions[0]}
            </p>
          )}
        </div>

        {health.factors.length > 0 && (
          <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {health.factors.map((factor) => {
              const percent = (factor.score / factor.maxScore) * 100;
              return (
                <div key={factor.id}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium">{factor.label}</span>
                    <span className="tabular-nums text-muted">{factor.score}/{factor.maxScore}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{factor.detail}</p>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
