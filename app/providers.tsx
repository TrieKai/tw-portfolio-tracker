"use client";

import { AppShell } from "@/components/layout/AppShell";
import { PortfolioProvider } from "@/providers/PortfolioProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PortfolioProvider>
        <AppShell>{children}</AppShell>
      </PortfolioProvider>
    </ThemeProvider>
  );
}
