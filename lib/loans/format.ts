import { formatCurrency } from "@/lib/portfolio/calculations";

/** 正值代表扣除成本，負值代表補貼或對帳回沖。 */
export function formatFinancingCostImpact(value: number): string {
  if (value > 0) return `−${formatCurrency(value)}`;
  if (value < 0) return `+${formatCurrency(Math.abs(value))}`;
  return formatCurrency(0);
}
