"use client";

import { useEffect, useState } from "react";
import { requestAiLayout } from "@/lib/client/ai-layout-api";
import type {
  DashboardGridWidth,
  DashboardSectionId,
  UiCardStyle,
  UiDensity,
  UiPalette,
  UiTheme,
} from "@/lib/types/ui-preferences";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";

const EXAMPLES = [
  "專業深藍色，資訊緊湊，趨勢佔三分之二，曝險佔三分之一並排",
  "明亮溫暖、留白多一點，資產配置與快速統計各半並排",
  "低調深色系，隱藏資產配置與快速統計，持倉放最後",
] as const;

const SECTION_LABELS: Record<DashboardSectionId, string> = {
  summary: "資產摘要",
  allocation: "資產配置",
  quickStats: "快速統計",
  exposure: "資產曝險",
  monthlyPnl: "月度損益",
  trend: "資產趨勢",
  holdings: "持倉摘要",
};

const WIDTH_LABELS: Record<DashboardGridWidth, string> = {
  full: "全寬",
  twoThirds: "2/3",
  half: "1/2",
  oneThird: "1/3",
};

const WIDTH_CLASSES: Record<DashboardGridWidth, string> = {
  full: "col-span-12",
  twoThirds: "col-span-8",
  half: "col-span-6",
  oneThird: "col-span-4",
};

const THEME_LABELS: Record<UiTheme, string> = {
  light: "淺色",
  dark: "深色",
  system: "跟隨系統",
};

const PALETTE_LABELS: Record<UiPalette, string> = {
  emerald: "穩健綠",
  ocean: "專業藍",
  indigo: "科技靛藍",
  rose: "溫暖玫紅",
  amber: "明亮琥珀",
  slate: "低彩灰藍",
};

const DENSITY_LABELS: Record<UiDensity, string> = {
  comfortable: "標準密度",
  compact: "資訊緊湊",
  spacious: "寬鬆留白",
};

const CARD_LABELS: Record<UiCardStyle, string> = {
  soft: "柔和卡片",
  outlined: "簡潔線框",
  glass: "玻璃質感",
};

export function AiLayoutAssistantModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    preferences,
    theme,
    preview,
    previewSuggestion,
    clearPreview,
    applyPreview,
    previewDefaults,
  } = useUiPreferences();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      clearPreview();
    };
  }, [clearPreview, onClose]);

  async function generate() {
    const text = prompt.trim();
    if (text.length < 3) {
      setError("請至少用 3 個字描述想要的版面或色調");
      return;
    }

    setLoading(true);
    setError(null);
    setSaved(false);
    const result = await requestAiLayout(text, theme, preferences);
    setLoading(false);

    if (!result.success) {
      setError(
        result.suggestion
          ? `${result.error}（${result.suggestion}）`
          : result.error
      );
      return;
    }

    previewSuggestion(result.data);
  }

  function savePreview() {
    if (!applyPreview()) return;
    setSaved(true);
    window.setTimeout(onClose, 650);
  }

  function close() {
    clearPreview();
    onClose();
  }

  function showDefaults() {
    setError(null);
    setSaved(false);
    previewDefaults();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-layout-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface shadow-2xl sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-dim text-sm text-accent"
                aria-hidden
              >
                ✦
              </span>
              <h2 id="ai-layout-title" className="text-lg font-bold">
                AI 版面助理
              </h2>
            </div>
            <p className="text-sm text-muted">
              用自然語言描述色調、密度、區塊順序與網格寬度。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="touch-target shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-raised hover:text-foreground"
            aria-label="關閉 AI 版面助理"
          >
            關閉
          </button>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
          <div>
            <label htmlFor="ai-layout-prompt" className="mb-2 block text-sm font-semibold">
              你希望畫面看起來怎麼樣？
            </label>
            <textarea
              id="ai-layout-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value.slice(0, 500))}
              rows={4}
              className="input-field resize-none"
              placeholder="例如：我喜歡專業的深藍色，資訊排緊一點，先看損益和趨勢圖…"
              disabled={loading}
              autoFocus
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
              <span>只會傳送這段描述與目前介面設定，不會傳送持倉資料。</span>
              <span>{prompt.length}/500</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="描述範例">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                disabled={loading}
                className="rounded-full border border-border bg-surface-raised px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent hover:text-foreground disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          {saved && (
            <div
              role="status"
              className="rounded-xl border border-accent/30 bg-accent-dim px-4 py-3 text-sm text-accent"
            >
              已套用並記住這組版面。
            </div>
          )}

          {preview && (
            <div className="space-y-4 rounded-2xl border border-accent/30 bg-accent-dim/40 p-4 sm:p-5">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">正在預覽 AI 建議</h3>
                  <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                    尚未儲存
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {preview.rationale}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                  {THEME_LABELS[preview.theme]}
                </span>
                <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                  {PALETTE_LABELS[preview.palette]}
                </span>
                <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                  {DENSITY_LABELS[preview.density]}
                </span>
                <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                  {CARD_LABELS[preview.cardStyle]}
                </span>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted">桌面網格預覽</p>
                  <p className="text-[11px] text-muted">手機自動單欄</p>
                </div>
                <ol className="grid grid-cols-12 gap-2 rounded-xl border border-dashed border-border bg-surface-raised/50 p-2 text-xs">
                  {preview.dashboardLayout.map((item, index) => {
                    const hidden = item.hidden;
                    return (
                      <li
                        key={item.section}
                        className={`${WIDTH_CLASSES[item.width]} flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-2 ${
                          hidden ? "opacity-50" : ""
                        }`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] text-muted">
                          {index + 1}
                        </span>
                        <span className="min-w-0 truncate">
                          {SECTION_LABELS[item.section]}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted">
                          {hidden ? "隱藏" : WIDTH_LABELS[item.width]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={showDefaults}
              disabled={loading}
              className="btn-secondary justify-center"
            >
              預覽預設版面
            </button>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {preview && (
                <button
                  type="button"
                  onClick={clearPreview}
                  disabled={loading}
                  className="btn-secondary justify-center"
                >
                  取消預覽
                </button>
              )}
              <button
                type="button"
                onClick={() => void generate()}
                disabled={loading || prompt.trim().length < 3}
                className="btn-secondary justify-center"
              >
                {loading ? (
                  <>
                    <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-muted" />
                    AI 設計中…
                  </>
                ) : preview ? (
                  "重新產生"
                ) : (
                  "產生並預覽"
                )}
              </button>
              {preview && (
                <button
                  type="button"
                  onClick={savePreview}
                  disabled={loading || saved}
                  className="btn-primary justify-center"
                >
                  套用並記住
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
