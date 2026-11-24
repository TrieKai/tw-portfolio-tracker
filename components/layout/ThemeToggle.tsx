"use client";

import { useTheme } from "@/providers/ThemeProvider";
import { useUiPreferences } from "@/providers/UiPreferencesProvider";

const CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];

const LABELS: Record<(typeof CYCLE)[number], string> = {
  light: "淺色",
  dark: "深色",
  system: "系統",
};

export function ThemeToggle() {
  const { theme } = useTheme();
  const { setThemePreference } = useUiPreferences();

  function cycle() {
    const i = CYCLE.indexOf(theme);
    setThemePreference(CYCLE[(i + 1) % CYCLE.length]);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="btn-secondary"
      aria-label={`切換主題，目前為${LABELS[theme]}`}
    >
      主題 · {LABELS[theme]}
    </button>
  );
}
