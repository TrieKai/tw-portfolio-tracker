export const DASHBOARD_SECTION_IDS = [
  "summary",
  "overview",
  "exposure",
  "monthlyPnl",
  "trend",
  "holdings",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export const UI_PALETTES = [
  "emerald",
  "ocean",
  "indigo",
  "rose",
  "amber",
  "slate",
] as const;

export type UiPalette = (typeof UI_PALETTES)[number];

export const UI_DENSITIES = ["comfortable", "compact", "spacious"] as const;

export type UiDensity = (typeof UI_DENSITIES)[number];

export const UI_CARD_STYLES = ["soft", "outlined", "glass"] as const;

export type UiCardStyle = (typeof UI_CARD_STYLES)[number];

export type UiTheme = "light" | "dark" | "system";

/** 可由 AI 建議、但只允許白名單值的介面偏好。 */
export interface UiPreferences {
  palette: UiPalette;
  density: UiDensity;
  cardStyle: UiCardStyle;
  dashboardOrder: DashboardSectionId[];
  hiddenSections: DashboardSectionId[];
  /** 有時間戳才代表使用者曾主動套用新版介面設定。 */
  updatedAt?: string;
}

export interface UiLayoutSuggestion extends UiPreferences {
  theme: UiTheme;
  rationale: string;
}

