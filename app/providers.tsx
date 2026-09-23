"use client";

import { SessionProvider } from "next-auth/react";
import { AppShell } from "@/components/layout/AppShell";
import { AmountPrivacyProvider } from "@/providers/AmountPrivacyProvider";
import { PortfolioProvider } from "@/providers/PortfolioProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <PortfolioProvider>
          <AmountPrivacyProvider>
            <AppShell>{children}</AppShell>
          </AmountPrivacyProvider>
        </PortfolioProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
