/**
 * 台股代號正規化
 * ----------------------------------------
 * - 一般上市櫃：4 碼數字（2330）
 * - ETF / 特別股：5 碼（00878）或 6 碼含字母尾綴（00631L、00632R）
 */

const LETTER_SUFFIX = /^(\d+)([A-Z])$/;

/**
 * 將使用者輸入轉為 TWSE MIS 使用的代號
 * @example "631L" → "00631L", "2330" → "2330", "878" → "0878"（5 碼請輸入 00878）
 */
export function normalizeStockSymbol(symbol: string): string {
  const raw = symbol.trim().toUpperCase().replace(/\s/g, "");

  const letterMatch = raw.match(LETTER_SUFFIX);
  if (letterMatch) {
    const digits = letterMatch[1].padStart(5, "0");
    return `${digits}${letterMatch[2]}`;
  }

  if (/^\d+$/.test(raw)) {
    if (raw.length <= 4) return raw.padStart(4, "0");
    if (raw.length === 5) return raw.padStart(5, "0");
    return raw.padStart(6, "0");
  }

  return raw;
}

/**
 * 查價時依序嘗試的代號候選（避免 878 vs 00878 等歧義）
 */
export function buildStockSymbolCandidates(symbol: string): string[] {
  const raw = symbol.trim().toUpperCase().replace(/\s/g, "");
  const seen = new Set<string>();

  const add = (s: string) => {
    if (s) seen.add(s);
  };

  add(normalizeStockSymbol(raw));
  add(raw);

  const letterMatch = raw.match(LETTER_SUFFIX);
  if (letterMatch) {
    add(`${letterMatch[1].padStart(5, "0")}${letterMatch[2]}`);
  }

  if (/^\d+$/.test(raw)) {
    add(raw.padStart(4, "0"));
    add(raw.padStart(5, "0"));
    add(raw.padStart(6, "0"));
  }

  return [...seen];
}

/** 是否為合法台股代號格式（數字或數字+單一字母） */
export function isValidStockSymbolInput(symbol: string): boolean {
  const raw = symbol.trim().toUpperCase();
  return /^(\d{1,6}|\d{1,5}[A-Z])$/.test(raw);
}
