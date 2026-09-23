"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatCurrency } from "@/lib/portfolio/calculations";

const AMOUNT_PRIVACY_STORAGE_KEY = "portfolio-hide-amounts-v1";
const HIDDEN_AMOUNT = "••••";

interface AmountPrivacyContextValue {
  amountsHidden: boolean;
  toggleAmountsHidden: () => void;
  maskAmount: (value: string) => string;
  formatAmount: (value: number) => string;
}

const AmountPrivacyContext = createContext<AmountPrivacyContextValue | null>(
  null
);

function loadAmountsHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AMOUNT_PRIVACY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AmountPrivacyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [amountsHidden, setAmountsHidden] = useState(false);

  useEffect(() => {
    setAmountsHidden(loadAmountsHidden());
  }, []);

  const toggleAmountsHidden = useCallback(() => {
    setAmountsHidden((current) => {
      const next = !current;
      try {
        localStorage.setItem(AMOUNT_PRIVACY_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 無痕模式或儲存空間不可用時，仍保留本次頁面的切換結果。
      }
      return next;
    });
  }, []);

  const maskAmount = useCallback(
    (value: string) => (amountsHidden ? HIDDEN_AMOUNT : value),
    [amountsHidden]
  );
  const formatAmount = useCallback(
    (value: number) => maskAmount(formatCurrency(value)),
    [maskAmount]
  );

  const value = useMemo(
    () => ({ amountsHidden, toggleAmountsHidden, maskAmount, formatAmount }),
    [amountsHidden, toggleAmountsHidden, maskAmount, formatAmount]
  );

  return (
    <AmountPrivacyContext.Provider value={value}>
      {children}
    </AmountPrivacyContext.Provider>
  );
}

export function useAmountPrivacy() {
  const context = useContext(AmountPrivacyContext);
  if (!context) {
    throw new Error("useAmountPrivacy 必須在 AmountPrivacyProvider 內使用");
  }
  return context;
}
