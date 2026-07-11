import {
  DASHBOARD_GRID_WIDTHS,
  DASHBOARD_CARD_VIEWS,
  DASHBOARD_SECTION_IDS,
  UI_CARD_STYLES,
  UI_DENSITIES,
  UI_PALETTES,
  type DashboardGridWidth,
  type DashboardLayoutItem,
  type DashboardSectionId,
  type UiCardStyle,
  type UiDensity,
  type UiLayoutSuggestion,
  type UiPalette,
  type UiPreferences,
  type UiTheme,
} from "@/lib/types/ui-preferences";

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  palette: "emerald",
  density: "comfortable",
  cardStyle: "glass",
  dashboardLayout: [
    { section: "timeTravel", width: "full", hidden: false, view: "standard" },
    { section: "insights", width: "full", hidden: false, view: "standard" },
    { section: "stressTest", width: "half", hidden: false, view: "standard" },
    { section: "rebalance", width: "half", hidden: false, view: "standard" },
    { section: "summary", width: "full", hidden: false, view: "standard" },
    { section: "allocation", width: "half", hidden: false, view: "visual" },
    { section: "quickStats", width: "half", hidden: false, view: "compact" },
    { section: "exposure", width: "full", hidden: false, view: "standard" },
    { section: "monthlyPnl", width: "full", hidden: false, view: "standard" },
    { section: "trend", width: "full", hidden: false, view: "visual" },
    { section: "holdings", width: "full", hidden: false, view: "standard" },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAllowed<T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function defaultLayoutItem(section: DashboardSectionId): DashboardLayoutItem {
  return (
    DEFAULT_UI_PREFERENCES.dashboardLayout.find(
      (item) => item.section === section
    ) ?? { section, width: "full", hidden: false, view: "standard" }
  );
}

/** 去除重複與未知區塊，修正寬度，並把缺少的區塊安全補到最後。 */
export function normalizeDashboardLayout(raw: unknown): DashboardLayoutItem[] {
  let result: DashboardLayoutItem[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const section = entry.section;
      if (
        !isAllowed(DASHBOARD_SECTION_IDS, section) ||
        result.some((item) => item.section === section)
      ) {
        continue;
      }
      const fallback = defaultLayoutItem(section);
      const width: DashboardGridWidth = isAllowed(
        DASHBOARD_GRID_WIDTHS,
        entry.width
      )
        ? entry.width
        : fallback.width;
      result.push({
        section,
        width,
        hidden: typeof entry.hidden === "boolean" ? entry.hidden : false,
        view: isAllowed(DASHBOARD_CARD_VIEWS, entry.view)
          ? entry.view
          : fallback.view,
      });
    }
  }

  // 新智慧區塊過去固定在可客製網格上方；升級舊設定時補到前方，
  // 既保留原本七個區塊的相對順序，也避免功能在升級後突然跑到頁尾。
  const smartSections: DashboardSectionId[] = [
    "timeTravel",
    "insights",
    "stressTest",
    "rebalance",
  ];
  const missingSmartSections = smartSections
    .filter((section) => !result.some((item) => item.section === section))
    .map((section) => ({ ...defaultLayoutItem(section) }));
  result = [...missingSmartSections, ...result];

  for (const section of DASHBOARD_SECTION_IDS) {
    if (!result.some((item) => item.section === section)) {
      result.push({ ...defaultLayoutItem(section) });
    }
  }
  return result;
}

/** 將舊版六區塊順序升級為七區塊網格，overview 拆為兩張半寬卡片。 */
function migrateLegacyDashboardLayout(raw: Record<string, unknown>) {
  const order = Array.isArray(raw.dashboardOrder)
    ? raw.dashboardOrder
    : [];
  const hidden = Array.isArray(raw.hiddenSections)
    ? raw.hiddenSections
    : [];
  const migrated: DashboardLayoutItem[] = [];

  for (const value of order) {
    if (value === "overview") {
      migrated.push(
        {
          section: "allocation",
          width: "half",
          hidden: hidden.includes("overview"),
          view: "visual",
        },
        {
          section: "quickStats",
          width: "half",
          hidden: hidden.includes("overview"),
          view: "compact",
        }
      );
      continue;
    }
    if (isAllowed(DASHBOARD_SECTION_IDS, value)) {
      migrated.push({
        ...defaultLayoutItem(value),
        hidden: hidden.includes(value),
      });
    }
  }

  return normalizeDashboardLayout(migrated);
}

export function normalizeUiPreferences(raw: unknown): UiPreferences {
  if (!isRecord(raw)) return { ...DEFAULT_UI_PREFERENCES };

  const palette: UiPalette = isAllowed(UI_PALETTES, raw.palette)
    ? raw.palette
    : DEFAULT_UI_PREFERENCES.palette;
  const density: UiDensity = isAllowed(UI_DENSITIES, raw.density)
    ? raw.density
    : DEFAULT_UI_PREFERENCES.density;
  const cardStyle: UiCardStyle = isAllowed(UI_CARD_STYLES, raw.cardStyle)
    ? raw.cardStyle
    : DEFAULT_UI_PREFERENCES.cardStyle;

  return {
    palette,
    density,
    cardStyle,
    dashboardLayout: Array.isArray(raw.dashboardLayout)
      ? normalizeDashboardLayout(raw.dashboardLayout)
      : migrateLegacyDashboardLayout(raw),
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
  };
}

export function normalizeUiLayoutSuggestion(
  raw: unknown
): UiLayoutSuggestion | null {
  if (!isRecord(raw)) return null;
  const preferences = normalizeUiPreferences(raw);
  const theme: UiTheme = isAllowed(
    ["light", "dark", "system"] as const,
    raw.theme
  )
    ? raw.theme
    : "system";

  return {
    ...preferences,
    theme,
    rationale:
      typeof raw.rationale === "string" && raw.rationale.trim()
        ? raw.rationale.trim().slice(0, 240)
        : "已依照你的描述調整版面與色調。",
  };
}
