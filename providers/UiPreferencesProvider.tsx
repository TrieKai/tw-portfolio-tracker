"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
    dashboardOrder: suggestion.dashboardOrder,
    hiddenSections: suggestion.hiddenSections,
  };
}

export function UiPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { storage, applyUiPreferences, setThemePreference: persistTheme } =
    usePortfolio();
  const {
    theme: localTheme,
    setTheme,
    previewTheme,
    clearThemePreview,
  } = useTheme();
  const [preview, setPreview] = useState<UiLayoutSuggestion | null>(null);

  const persistedPreferences = useMemo(
    () => normalizeUiPreferences(storage.settings.uiPreferences),
    [storage.settings.uiPreferences]
  );

  const preferences = preview
    ? suggestionToPreferences(preview)
    : persistedPreferences;
  const effectiveTheme = preview?.theme ?? localTheme;

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
    const nextPreferences = suggestionToPreferences(preview);
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
      setTheme(theme);
      persistTheme(theme);
    },
    [clearPreview, persistTheme, setTheme]
  );

  // 新版介面偏好在其他裝置載入時，同步其已確認的主題；舊資料仍沿用
  // portfolio-theme，避免升級後突然改變既有使用者的畫面。
  useEffect(() => {
    const updatedAt = storage.settings.uiPreferences?.updatedAt;
    const cloudTheme = storage.settings.theme;
    if (!preview && updatedAt && cloudTheme && cloudTheme !== localTheme) {
      setTheme(cloudTheme);
    }
  }, [
    storage.settings.uiPreferences?.updatedAt,
    storage.settings.theme,
    preview,
    localTheme,
    setTheme,
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

