import type {
  UiPreferences,
  UiTheme,
} from "@/lib/types/ui-preferences";
import { normalizeUiPreferences } from "@/lib/ui/preferences";

const UI_PREFERENCES_STORAGE_KEY = "portfolio-ui-preferences-v1";

export interface StoredUiAppearance {
  theme: UiTheme;
  preferences: UiPreferences;
}

function isUiTheme(value: unknown): value is UiTheme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * 版面偏好另存一份獨立快照，避免登入後載入整份雲端持倉時被舊設定覆蓋。
 * 投資組合內仍會保存同一份資料，供跨裝置同步使用。
 */
export function loadStoredUiAppearance(): StoredUiAppearance | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const value = parsed as {
      theme?: unknown;
      preferences?: unknown;
    };
    if (!isUiTheme(value.theme)) return null;

    const preferences = normalizeUiPreferences(value.preferences);
    if (!preferences.updatedAt) return null;
    return { theme: value.theme, preferences };
  } catch {
    return null;
  }
}

export function saveStoredUiAppearance(
  appearance: StoredUiAppearance
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(appearance));
}

