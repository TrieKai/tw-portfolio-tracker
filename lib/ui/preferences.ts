import {
  DASHBOARD_SECTION_IDS,
  UI_CARD_STYLES,
  UI_DENSITIES,
  UI_PALETTES,
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
  dashboardOrder: [...DASHBOARD_SECTION_IDS],
  hiddenSections: [],
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

/** 去除重複與未知區塊，並把缺少的區塊補到最後。 */
export function normalizeDashboardOrder(raw: unknown): DashboardSectionId[] {
  const allowed = new Set<string>(DASHBOARD_SECTION_IDS);
  const result: DashboardSectionId[] = [];

  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (
        typeof value === "string" &&
        allowed.has(value) &&
        !result.includes(value as DashboardSectionId)
      ) {
        result.push(value as DashboardSectionId);
      }
    }
  }

  for (const section of DASHBOARD_SECTION_IDS) {
    if (!result.includes(section)) result.push(section);
  }
  return result;
}

export function normalizeHiddenSections(raw: unknown): DashboardSectionId[] {
  if (!Array.isArray(raw)) return [];
  return DASHBOARD_SECTION_IDS.filter((section) => raw.includes(section));
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
    dashboardOrder: normalizeDashboardOrder(raw.dashboardOrder),
    hiddenSections: normalizeHiddenSections(raw.hiddenSections),
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

