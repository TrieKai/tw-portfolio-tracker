"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";
import { requestAiLayout } from "@/lib/client/ai-layout-api";
import type {
  DashboardGridWidth,
  DashboardCardView,
  DashboardSectionId,
  UiCardStyle,
  UiDensity,
  UiPalette,
  UiTheme,
  UiLayoutSuggestion,
} from "@/lib/types/ui-preferences";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";

const EXAMPLES = [
  "專業深藍色，資訊緊湊，趨勢佔三分之二，曝險佔三分之一並排",
  "明亮溫暖、留白多一點，資產配置與快速統計各半並排",
  "低調深色系，隱藏資產配置與快速統計，持倉放最後",
] as const;

const SECTION_LABELS: Record<DashboardSectionId, string> = {
  timeTravel: "投資時光機",
  insights: "投資天氣與健康",
  stressTest: "資產壓力測試",
  rebalance: "再平衡導航",
  summary: "資產摘要",
  allocation: "資產配置",
  quickStats: "快速統計",
  exposure: "資產曝險",
  monthlyPnl: "月度損益",
  trend: "資產趨勢",
  holdings: "持倉摘要",
};

const SECTION_ICONS: Record<DashboardSectionId, string> = {
  timeTravel: "◷",
  insights: "☀",
  stressTest: "≋",
  rebalance: "⇄",
  summary: "◫",
  allocation: "◔",
  quickStats: "⚡",
  exposure: "◎",
  monthlyPnl: "±",
  trend: "↗",
  holdings: "≡",
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

const WIDTH_PREVIEW_CLASSES: Record<DashboardGridWidth, string> = {
  full: "w-full",
  twoThirds: "w-2/3",
  half: "w-1/2",
  oneThird: "w-1/3",
};

const VIEW_OPTIONS: Array<{
  value: DashboardCardView;
  icon: string;
  label: string;
}> = [
  { value: "standard", icon: "▤", label: "完整" },
  { value: "compact", icon: "▬", label: "精簡" },
  { value: "visual", icon: "◉", label: "圖像" },
];

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

function layoutFingerprint(layout: UiLayoutSuggestion): string {
  return JSON.stringify({
    theme: layout.theme,
    palette: layout.palette,
    density: layout.density,
    cardStyle: layout.cardStyle,
    dashboardLayout: layout.dashboardLayout,
  });
}

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
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const draftInitialized = useRef(false);
  const initialLayoutFingerprint = useRef<string | null>(null);
  const [draggedSection, setDraggedSection] =
    useState<DashboardSectionId | null>(null);
  const [dragOverSection, setDragOverSection] =
    useState<DashboardSectionId | null>(null);

  useEffect(() => {
    if (draftInitialized.current) return;
    draftInitialized.current = true;
    const currentLayout: UiLayoutSuggestion = {
      ...preferences,
      theme,
      rationale: "這是目前正在使用的首頁版型，可直接拖曳與調整。",
    };
    initialLayoutFingerprint.current = layoutFingerprint(currentLayout);
    previewSuggestion(currentLayout);
  }, [preferences, previewSuggestion, theme]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearPreview();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
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
    setProviderNotice(null);
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

    if (result.provider === "groq") {
      setProviderNotice("這次由 Groq 免費方案產生版面。");
    } else if (result.provider === "gemini" && result.fallbackUsed) {
      setProviderNotice("Groq 暫時無法使用，已自動改用 Gemini 備援。");
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
    setProviderNotice(null);
    previewDefaults();
  }

  function updatePreviewLayout(
    update: (
      layout: NonNullable<typeof preview>["dashboardLayout"]
    ) => NonNullable<typeof preview>["dashboardLayout"]
  ) {
    if (!preview) return;
    previewSuggestion({
      ...preview,
      dashboardLayout: update(preview.dashboardLayout),
    });
  }

  function updatePreviewAppearance(
    update: Partial<
      Pick<UiLayoutSuggestion, "theme" | "palette" | "density" | "cardStyle">
    >
  ) {
    if (!preview) return;
    previewSuggestion({ ...preview, ...update });
    setSaved(false);
  }

  function reorderSection(
    sourceSection: DashboardSectionId,
    targetSection: DashboardSectionId
  ) {
    updatePreviewLayout((layout) => {
      const source = layout.findIndex((item) => item.section === sourceSection);
      const target = layout.findIndex((item) => item.section === targetSection);
      if (source < 0 || target < 0 || source === target) return layout;
      const next = [...layout];
      const [moved] = next.splice(source, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  function startSectionDrag(
    event: DragEvent<HTMLElement>,
    section: DashboardSectionId
  ) {
    if ((event.target as HTMLElement).closest("button, select")) {
      event.preventDefault();
      return;
    }
    setDraggedSection(section);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", section);
  }

  function dropSection(
    event: DragEvent<HTMLElement>,
    targetSection: DashboardSectionId
  ) {
    event.preventDefault();
    const source =
      draggedSection ??
      (event.dataTransfer.getData("text/plain") as DashboardSectionId);
    if (source) reorderSection(source, targetSection);
    setDraggedSection(null);
    setDragOverSection(null);
  }

  function setSectionWidth(
    section: DashboardSectionId,
    width: DashboardGridWidth
  ) {
    updatePreviewLayout((layout) =>
      layout.map((item) =>
        item.section === section ? { ...item, width } : item
      )
    );
  }

  function toggleSection(section: DashboardSectionId) {
    updatePreviewLayout((layout) =>
      layout.map((item) =>
        item.section === section ? { ...item, hidden: !item.hidden } : item
      )
    );
  }

  function setSectionView(
    section: DashboardSectionId,
    view: DashboardCardView
  ) {
    updatePreviewLayout((layout) =>
      layout.map((item) =>
        item.section === section ? { ...item, view } : item
      )
    );
  }

  const previewChanged = preview
    ? layoutFingerprint(preview) !== initialLayoutFingerprint.current
    : false;

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
                ▦
              </span>
              <h2 id="ai-layout-title" className="text-lg font-bold">
                版面設定
              </h2>
            </div>
            <p className="text-sm text-muted">
              直接調整外觀與拖曳版面，也可以選擇讓 AI 協助排版。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="touch-target shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-raised hover:text-foreground"
            aria-label="關閉版面設定"
          >
            關閉
          </button>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised/40">
            <button
              type="button"
              onClick={() => setAiPanelOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-raised"
              aria-expanded={aiPanelOpen}
              aria-controls="ai-layout-panel"
            >
              <span>
                <span className="block text-sm font-semibold">✦ 交給 AI 排版</span>
                <span className="mt-0.5 block text-xs text-muted">
                  選用功能，只有送出描述時才會使用 AI 額度
                </span>
              </span>
              <span className="text-sm text-muted" aria-hidden>
                {aiPanelOpen ? "收合" : "展開"}
              </span>
            </button>

            {aiPanelOpen && (
              <div id="ai-layout-panel" className="space-y-3 border-t border-border p-4">
                <div>
                  <label htmlFor="ai-layout-prompt" className="mb-2 block text-sm font-semibold">
                    你希望畫面看起來怎麼樣？
                  </label>
                  <textarea
                    id="ai-layout-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value.slice(0, 500))}
                    rows={3}
                    className="input-field resize-none"
                    placeholder="例如：專業深藍色，趨勢佔三分之二，曝險放右邊…"
                    disabled={loading}
                  />
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
                    <span>只傳送描述與介面設定，不會傳送持倉資料。</span>
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
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent hover:text-foreground disabled:opacity-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>

                {error && (
                  <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
                    {error}
                  </div>
                )}
                {providerNotice && (
                  <div role="status" className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
                    {providerNotice}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={loading || prompt.trim().length < 3}
                    className="btn-secondary justify-center"
                  >
                    {loading ? "AI 設計中…" : "產生版面草稿"}
                  </button>
                </div>
              </div>
            )}
          </div>

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
                  <div>
                    <h3 className="font-semibold">
                      {previewChanged ? "自訂版型" : "目前版型"}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      下方就是首頁目前的排列，可拖曳區塊或調整寬度與內容形態。
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${previewChanged ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-accent text-white"}`}>
                    {previewChanged ? "尚未套用" : "目前套用"}
                  </span>
                </div>
                {previewChanged && (
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {preview.rationale}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                {([
                  ["主題", "theme", preview.theme, THEME_LABELS],
                  ["色系", "palette", preview.palette, PALETTE_LABELS],
                  ["密度", "density", preview.density, DENSITY_LABELS],
                  ["卡片", "cardStyle", preview.cardStyle, CARD_LABELS],
                ] as const).map(([label, key, value, labels]) => (
                  <label key={key} className="space-y-1.5 text-muted">
                    <span>{label}</span>
                    <select
                      value={value}
                      onChange={(event) =>
                        updatePreviewAppearance({ [key]: event.target.value })
                      }
                      className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-foreground"
                    >
                      {Object.entries(labels).map(([option, optionLabel]) => (
                        <option key={option} value={option}>{optionLabel}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted">桌面版面</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted">
                    <span aria-hidden>⠿</span> 拖曳排列
                  </p>
                </div>
                <ol className="grid grid-cols-12 gap-2 rounded-xl border border-dashed border-border bg-surface-raised/50 p-2 text-xs">
                  {preview.dashboardLayout.map((item, index) => {
                    const hidden = item.hidden;
                    return (
                      <li
                        key={item.section}
                        draggable
                        onDragStart={(event) =>
                          startSectionDrag(event, item.section)
                        }
                        onDragEnd={() => {
                          setDraggedSection(null);
                          setDragOverSection(null);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverSection(item.section);
                        }}
                        onDragLeave={() =>
                          setDragOverSection((current) =>
                            current === item.section ? null : current
                          )
                        }
                        onDrop={(event) => dropSection(event, item.section)}
                        aria-label={`拖曳${SECTION_LABELS[item.section]}調整位置`}
                        className={`${WIDTH_CLASSES[item.width]} group relative flex min-h-24 min-w-0 cursor-grab flex-col justify-between gap-3 overflow-hidden rounded-xl border bg-surface p-2.5 transition-all duration-200 ${
                          dragOverSection === item.section &&
                          draggedSection !== item.section
                            ? "border-accent bg-accent-dim/50 ring-2 ring-accent/25"
                            : "border-border"
                        } ${
                          draggedSection === item.section
                            ? "z-20 -translate-y-1 scale-[1.03] rotate-[0.5deg] cursor-grabbing border-accent opacity-80 shadow-2xl"
                            : "shadow-sm hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg"
                        } ${hidden && draggedSection !== item.section ? "opacity-50" : ""}`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="select-none text-lg leading-none text-muted transition group-hover:text-accent"
                            aria-hidden
                          >
                            ⠿
                          </span>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-dim text-lg font-semibold text-accent" aria-hidden>
                            {SECTION_ICONS[item.section]}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {SECTION_LABELS[item.section]}
                          </span>
                          <button
                            type="button"
                            draggable={false}
                            onClick={() => toggleSection(item.section)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base text-muted transition hover:bg-surface-raised hover:text-foreground"
                            aria-label={`${hidden ? "顯示" : "隱藏"}${SECTION_LABELS[item.section]}`}
                            title={hidden ? "顯示區塊" : "隱藏區塊"}
                          >
                            <span aria-hidden>{hidden ? "◌" : "◉"}</span>
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-[10px] tabular-nums text-muted">
                            {index + 1}
                          </span>
                          <div className="flex gap-0.5" aria-label={`${SECTION_LABELS[item.section]}內容形態`}>
                            {VIEW_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                draggable={false}
                                disabled={hidden}
                                onClick={() => setSectionView(item.section, option.value)}
                                aria-label={`${SECTION_LABELS[item.section]}使用${option.label}模式`}
                                aria-pressed={item.view === option.value}
                                title={`${option.label}模式`}
                                className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition ${
                                  item.view === option.value
                                    ? "bg-accent-dim text-accent"
                                    : "text-muted hover:bg-surface-raised hover:text-foreground"
                                }`}
                              >
                                <span aria-hidden>{option.icon}</span>
                              </button>
                            ))}
                          </div>
                          <div className="flex rounded-lg border border-border bg-surface-raised p-0.5" aria-label={`${SECTION_LABELS[item.section]}寬度`}>
                            {(Object.keys(WIDTH_LABELS) as DashboardGridWidth[]).map((width) => (
                              <button
                                key={width}
                                type="button"
                                draggable={false}
                                onClick={() => setSectionWidth(item.section, width)}
                                disabled={hidden}
                                aria-label={`${SECTION_LABELS[item.section]}設為${WIDTH_LABELS[width]}`}
                                aria-pressed={item.width === width}
                                title={WIDTH_LABELS[width]}
                                className={`flex h-7 w-7 items-center justify-center rounded-md transition disabled:cursor-not-allowed ${
                                  item.width === width
                                    ? "bg-accent text-white shadow-sm"
                                    : "text-muted hover:bg-surface hover:text-foreground"
                                }`}
                              >
                                <span className="flex h-3.5 w-4 items-center rounded-[3px] border border-current p-[2px]" aria-hidden>
                                  <span className={`${WIDTH_PREVIEW_CLASSES[width]} h-full rounded-[1px] bg-current`} />
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
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
              恢復預設版面
            </button>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={close}
                disabled={loading}
                className="btn-secondary justify-center"
              >
                {previewChanged ? "取消變更" : "關閉"}
              </button>
              {preview && (
                <button
                  type="button"
                  onClick={savePreview}
                  disabled={loading || saved || !previewChanged}
                  className="btn-primary justify-center"
                >
                  {saved
                    ? "已套用"
                    : previewChanged
                      ? "套用自訂版型"
                      : "目前已套用"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
