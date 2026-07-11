export const DASHBOARD_SECTION_IDS = [
  "summary",
  "allocation",
  "quickStats",
  "exposure",
  "monthlyPnl",
  "trend",
  "holdings",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export const DASHBOARD_GRID_WIDTHS = [
  "full",
  "twoThirds",
  "half",
  "oneThird",
] as const;

export type DashboardGridWidth = (typeof DASHBOARD_GRID_WIDTHS)[number];

export const DASHBOARD_CARD_VIEWS = ["standard", "compact", "visual"] as const;

export type DashboardCardView = (typeof DASHBOARD_CARD_VIEWS)[number];

export interface DashboardLayoutItem {
  section: DashboardSectionId;
  width: DashboardGridWidth;
  hidden: boolean;
  /** 同一區塊可依使用情境切換完整資訊、精簡摘要或圖像優先。 */
  view: DashboardCardView;
}

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
  /** 12 欄桌面網格；手機固定依陣列順序顯示為單欄。 */
  dashboardLayout: DashboardLayoutItem[];
  /** 有時間戳才代表使用者曾主動套用新版介面設定。 */
  updatedAt?: string;
}

export interface UiLayoutSuggestion extends UiPreferences {
  theme: UiTheme;
  rationale: string;
}
