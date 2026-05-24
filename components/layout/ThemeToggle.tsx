"use client";

import { useTheme } from "@/providers/ThemeProvider";

const CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];

const LABELS: Record<(typeof CYCLE)[number], string> = {
  light: "淺色",
  dark: "深色",
  system: "系統",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycle() {
    const i = CYCLE.indexOf(theme);
    setTheme(CYCLE[(i + 1) % CYCLE.length]);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-muted transition hover:text-foreground"
      title="切換主題"
    >
      {LABELS[theme]}
    </button>
  );
}
