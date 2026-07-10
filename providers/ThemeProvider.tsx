"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PortfolioSettings } from "@/lib/types/holding";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  previewTheme: (t: Theme) => void;
  clearThemePreview: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyDomTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({
  children,
  initialTheme = "system",
}: {
  children: React.ReactNode;
  initialTheme?: PortfolioSettings["theme"];
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme ?? "system");
  const [themePreview, setThemePreview] = useState<Theme | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    setThemePreview(null);
    if (typeof window !== "undefined") {
      localStorage.setItem("portfolio-theme", t);
    }
  }, []);

  const previewTheme = useCallback((t: Theme) => {
    setThemePreview(t);
  }, []);

  const clearThemePreview = useCallback(() => {
    setThemePreview(null);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("portfolio-theme") as Theme | null;
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setThemeState(stored);
    }
  }, []);

  useEffect(() => {
    const effectiveTheme = themePreview ?? theme;
    const resolved =
      effectiveTheme === "system" ? getSystemTheme() : effectiveTheme;
    setResolvedTheme(resolved);
    applyDomTheme(resolved);

    if (effectiveTheme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next = getSystemTheme();
      setResolvedTheme(next);
      applyDomTheme(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, themePreview]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      previewTheme,
      clearThemePreview,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      previewTheme,
      clearThemePreview,
    ]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必須在 ThemeProvider 內使用");
  return ctx;
}
