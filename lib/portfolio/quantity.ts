const quantityFormat = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 17 });

function sameQuantity(a: number, b: number): boolean {
  if (a === b) return true;
  if (Number.isInteger(a) && Number.isInteger(b)) return false;
  // 避免相對容差在大量持股時放大，吞掉實際可交易的餘量。
  const roundoff = Math.min(4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)), 1e-6);
  return Math.abs(a - b) <= roundoff;
}

/** 只在短十進位表示與原值相差浮點運算誤差時，去除數量尾數。 */
export function removeQuantityRoundoff(quantity: number): number {
  if (!Number.isFinite(quantity) || Number.isInteger(quantity)) return quantity;
  const decimal = Number(quantity.toPrecision(12));
  return sameQuantity(quantity, decimal) ? decimal : quantity;
}

export function formatQuantity(quantity: number): string {
  const display = removeQuantityRoundoff(quantity);
  return display !== 0 && Math.abs(display) < 1e-8 ? String(display) : quantityFormat.format(display);
}

export function quantityAvailability(quantity: number, available: number): "full" | "partial" | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(available) || available <= 0) return null;
  if (sameQuantity(quantity, available)) return "full";
  return quantity < available ? "partial" : null;
}
