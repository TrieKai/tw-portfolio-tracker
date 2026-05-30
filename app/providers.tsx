"use client";

import { SessionProvider } from "next-auth/react";
import { AppShell } from "@/components/layout/AppShell";
import { PortfolioProvider } from "@/providers/PortfolioProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <PortfolioProvider>
          <AppShell>{children}</AppShell>
        </PortfolioProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
