"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadStoredUiAppearance,
  saveStoredUiAppearance,
  type StoredUiAppearance,
} from "@/lib/client/ui-preferences-storage";
import { DEFAULT_UI_PREFERENCES, normalizeUiPreferences } from "@/lib/ui/preferences";
import type {
  UiLayoutSuggestion,
  UiPreferences,
  UiTheme,
} from "@/lib/types/ui-preferences";
import { usePortfolio } from "@/providers/PortfolioProvider";
import { useTheme } from "@/providers/ThemeProvider";

interface UiPreferencesContextValue {
  preferences: UiPreferences;
  theme: UiTheme;
  preview: UiLayoutSuggestion | null;
  previewSuggestion: (suggestion: UiLayoutSuggestion) => void;
  clearPreview: () => void;
  applyPreview: () => boolean;
  previewDefaults: () => void;
  setThemePreference: (theme: UiTheme) => void;
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(
  null
);

function suggestionToPreferences(
  suggestion: UiLayoutSuggestion
): UiPreferences {
  return {
    palette: suggestion.palette,
    density: suggestion.density,
    cardStyle: suggestion.cardStyle,
    dashboardLayout: suggestion.dashboardLayout,
  };
}

export function UiPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { storage, applyUiPreferences } = usePortfolio();
  const {
    theme: localTheme,
    setTheme,
    previewTheme,
    clearThemePreview,
  } = useTheme();
  const [preview, setPreview] = useState<UiLayoutSuggestion | null>(null);
  const [localAppearance, setLocalAppearance] =
    useState<StoredUiAppearance | null>(null);
  const [localAppearanceLoaded, setLocalAppearanceLoaded] = useState(false);

  const persistedPreferences = useMemo(
    () => normalizeUiPreferences(storage.settings.uiPreferences),
    [storage.settings.uiPreferences]
  );

  const portfolioAppearance = useMemo<StoredUiAppearance>(
    () => ({
      theme: storage.settings.theme ?? localTheme,
      preferences: persistedPreferences,
    }),
    [storage.settings.theme, localTheme, persistedPreferences]
  );

  // 同一裝置只要曾明確套用過外觀，本機快照就是唯一畫面來源。
  // 雲端只負責初始化沒有本機快照的新裝置，不能在重新整理時反向覆蓋。
  const committedAppearance = localAppearance ?? portfolioAppearance;

  const preferences = preview
    ? suggestionToPreferences(preview)
    : committedAppearance.preferences;
  const effectiveTheme = preview?.theme ?? committedAppearance.theme;

  const previewSuggestion = useCallback(
    (suggestion: UiLayoutSuggestion) => {
      setPreview(suggestion);
      previewTheme(suggestion.theme);
    },
    [previewTheme]
  );

  const clearPreview = useCallback(() => {
    setPreview(null);
    clearThemePreview();
  }, [clearThemePreview]);

  const applyPreview = useCallback(() => {
    if (!preview) return false;
    const nextPreferences: UiPreferences = {
      ...suggestionToPreferences(preview),
      updatedAt: new Date().toISOString(),
    };
    const appearance = {
      theme: preview.theme,
      preferences: nextPreferences,
    };
    saveStoredUiAppearance(appearance);
    setLocalAppearance(appearance);
    applyUiPreferences(preview.theme, nextPreferences);
    setTheme(preview.theme);
    setPreview(null);
    return true;
  }, [preview, applyUiPreferences, setTheme]);

  const previewDefaults = useCallback(() => {
    previewSuggestion({
      ...DEFAULT_UI_PREFERENCES,
      theme: "system",
      rationale: "恢復系統主題、預設綠色系與標準首頁順序。",
    });
  }, [previewSuggestion]);

  const setThemePreference = useCallback(
    (theme: UiTheme) => {
      clearPreview();
      const nextPreferences: UiPreferences = {
        ...committedAppearance.preferences,
        updatedAt: new Date().toISOString(),
      };
      const appearance = { theme, preferences: nextPreferences };
      saveStoredUiAppearance(appearance);
      setLocalAppearance(appearance);
      setTheme(theme);
      applyUiPreferences(theme, nextPreferences);
    },
    [
      clearPreview,
      committedAppearance.preferences,
      setTheme,
      applyUiPreferences,
    ]
  );

  useEffect(() => {
    setLocalAppearance(loadStoredUiAppearance());
    setLocalAppearanceLoaded(true);
  }, []);

  // 本機有快照時固定採本機，並補寫到 portfolio 供雲端同步；只有全新裝置
  // 沒有本機快照時，才用雲端外觀初始化本機。
  useEffect(() => {
    // 首次 render 的 localAppearance 必為 null。必須等獨立快照讀取完成後才能
    // 比較，否則同一輪 Effect 會誤把舊雲端設定覆寫到新的本機快照。
    if (preview || !localAppearanceLoaded) return;

    const portfolioUpdatedAt = portfolioAppearance.preferences.updatedAt;

    if (localAppearance) {
      const localUpdatedAt = localAppearance.preferences.updatedAt;
      if (
        localUpdatedAt &&
        (portfolioUpdatedAt !== localUpdatedAt ||
          portfolioAppearance.theme !== localAppearance.theme)
      ) {
        applyUiPreferences(localAppearance.theme, localAppearance.preferences);
      }
      if (localAppearance.theme !== localTheme) {
        setTheme(localAppearance.theme);
      }
      return;
    }

    if (portfolioUpdatedAt) {
      saveStoredUiAppearance(portfolioAppearance);
      setLocalAppearance(portfolioAppearance);
    }

    if (
      portfolioUpdatedAt &&
      portfolioAppearance.theme !== localTheme
    ) {
      setTheme(portfolioAppearance.theme);
    }
  }, [
    preview,
    localAppearanceLoaded,
    localAppearance,
    portfolioAppearance,
    localTheme,
    setTheme,
    applyUiPreferences,
  ]);

  useEffect(
    () => () => {
      clearThemePreview();
    },
    [clearThemePreview]
  );

  const value = useMemo(
    () => ({
      preferences,
      theme: effectiveTheme,
      preview,
      previewSuggestion,
      clearPreview,
      applyPreview,
      previewDefaults,
      setThemePreference,
    }),
    [
      preferences,
      effectiveTheme,
      preview,
      previewSuggestion,
      clearPreview,
      applyPreview,
      previewDefaults,
      setThemePreference,
    ]
  );

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences() {
  const context = useContext(UiPreferencesContext);
  if (!context) {
    throw new Error("useUiPreferences 必須在 UiPreferencesProvider 內使用");
  }
  return context;
}
