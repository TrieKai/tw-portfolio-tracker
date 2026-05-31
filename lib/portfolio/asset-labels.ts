import type { AssetType } from "@/lib/types/holding";

/** 資產類型顯示名稱 */
export function getAssetTypeLabel(assetType: AssetType): string {
  switch (assetType) {
    case "stock":
      return "台股";
    case "fund":
      return "基金";
    case "property":
      return "房子";
  }
}

/** 是否可透過外部 API 自動更新價格 */
export function supportsAutoPriceUpdate(assetType: AssetType): boolean {
  return assetType === "stock" || assetType === "fund";
}

export function getQuantityLabel(assetType: AssetType): string {
  switch (assetType) {
    case "stock":
      return "股數";
    case "fund":
      return "單位數";
    case "property":
      return "數量（間）";
  }
}

export function getBuyPriceLabel(assetType: AssetType): string {
  switch (assetType) {
    case "property":
      return "購入總價";
    default:
      return "買入價格";
  }
}

export function getSellUnitLabel(assetType: AssetType): string {
  switch (assetType) {
    case "stock":
      return "股";
    case "fund":
      return "單位";
    case "property":
      return "間";
  }
}

export function getManualPriceLabel(assetType: AssetType): string {
  return assetType === "property" ? "現估總價" : "最新價格 / 淨值";
}
