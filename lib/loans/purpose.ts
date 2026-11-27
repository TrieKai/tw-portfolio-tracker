import type { LoanPurpose } from "@/lib/types/loan";

/** 房產與個人用途各有自己的負債分類，混合用途則按登錄比例分攤。 */
export function investmentUsePercentForPurpose(purpose: LoanPurpose, percent?: number): number {
  if (purpose === "property" || purpose === "personal") return 0;
  return percent !== undefined && Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : purpose === "investment" ? 100 : 0;
}
