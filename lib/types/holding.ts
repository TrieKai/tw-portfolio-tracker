/**
 * 資產管理核心型別定義
 * ----------------------------------------
 * 持倉（Holding）為單一買入紀錄；同一標的可有多筆 Holding（不同買入日）。
 * 價格歷史（PricePoint）以 holdingId 為 key 儲存於本地端。
 */

/** 資產大類：台股 / 境內基金 / 房子 */
export type AssetType = "stock" | "fund" | "property";

/**
 * 台股上市櫃別
 * - tse：台灣證券交易所（上市）
 * - otc：櫃買中心（上櫃）
 */
export type StockMarket = "tse" | "otc";

/** 價格來源：自動 API / 使用者手動輸入 */
export type PriceSource = "api" | "manual";

/**
 * 單筆持倉
 * @property id - 本地唯一識別（UUID）
 * @property symbol - 股票代號、基金代碼，或房產代號（選填）
 * @property buyPrice - 買入均價（股票：元/股；基金：元/單位；房子：購入總價）
 * @property quantity - 股數、單位數，或房產數量（通常為 1）
 */
export interface Holding {
  id: string;
  assetType: AssetType;
  /** 顯示名稱（可從 API 更新） */
  name: string;
  symbol: string;
  /** 僅 stock 需要；fund 可省略 */
  market?: StockMarket;
  buyPrice: number;
  quantity: number;
  /** 買入日期 ISO YYYY-MM-DD */
  buyDate: string;
  /** 最新價格或淨值 */
  currentPrice?: number;
  /** 價格對應日期 */
  priceDate?: string;
  priceSource?: PriceSource;
  /** 最後成功/嘗試更新時間 */
  lastUpdatedAt?: string;
  /** 最近一次更新錯誤訊息（供 UI 提示） */
  lastError?: string;
  /**
   * 槓桿倍數（選填；未設定時依代號／名稱推斷）
   * 曝險金額 = 市值 × leverageMultiplier
   */
  leverageMultiplier?: number;
  createdAt: string;
  updatedAt: string;
}

/** 單日價格快照（用於趨勢圖） */
export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  price: number;
  source: PriceSource;
}

/** 價格歷史：holdingId → 依日期排序的點列 */
export type PriceHistoryMap = Record<string, PricePoint[]>;

/** 單筆賣出紀錄（已實現損益） */
export interface SaleTransaction {
  id: string;
  /** 賣出當下對應的持倉 id（全部賣出後持倉可能已刪除） */
  holdingId: string;
  assetType: AssetType;
  name: string;
  symbol: string;
  market?: StockMarket;
  /** 賣出時該筆持倉的成本均價 */
  buyPrice: number;
  quantity: number;
  sellPrice: number;
  /** 賣出日期 ISO YYYY-MM-DD */
  sellDate: string;
  /** 賣出成本 = buyPrice × quantity */
  costBasis: number;
  /** 成交金額 = sellPrice × quantity */
  proceeds: number;
  /** 已實現損益 = proceeds − costBasis */
  realizedPnl: number;
  createdAt: string;
}

/** 本地儲存完整狀態 */
export interface PortfolioStorage {
  version: 1;
  holdings: Holding[];
  priceHistory: PriceHistoryMap;
  /** 賣出紀錄（依 createdAt 追加；展示時依 sellDate 排序） */
  sales: SaleTransaction[];
  settings: PortfolioSettings;
}

export interface PortfolioSettings {
  /** 是否啟用每日自動更新（需使用者開啟分頁或 PWA 才有效） */
  autoUpdateEnabled: boolean;
  /** 上次批次更新時間 */
  lastBatchUpdateAt?: string;
  /** 偏好主題；null 表示跟隨系統 */
  theme?: "light" | "dark" | "system";
  /**
   * 淨資產／自有資金（元）
   * 用於曝險比例 = 總曝險 ÷ 淨資產；未設定時以「持倉市值 − liabilities」推算
   */
  netAssets?: number;
  /** 投資負債（信貸等，元）；淨資產未直接設定時從持倉市值扣除 */
  liabilities?: number;
}

/** 持倉加上計算後的損益欄位（僅前端使用，不寫入 storage） */
export interface HoldingWithMetrics extends Holding {
  costBasis: number;
  marketValue: number;
  pnl: number;
  returnRate: number;
  /** 是否有有效現價可計算 */
  hasLivePrice: boolean;
}

/** 投資組合彙總指標 */
export interface PortfolioSummary {
  totalCost: number;
  totalValue: number;
  /** 未實現損益（現有持倉） */
  totalPnl: number;
  totalReturnRate: number;
  /** 累計已實現損益（歷次賣出） */
  totalRealizedPnl: number;
  /** 本月已實現損益（sellDate 落在當月） */
  monthlyRealizedPnl: number;
  /** 本月賣出筆數 */
  monthlySaleCount: number;
  /**
   * 本月未實現損益變化（當月末日相對月初第一個可計算日的 pnl 差）
   * 無法推算時為 null（例如本月尚無價格歷史）
   */
  monthlyUnrealizedPnl: number | null;
  /**
   * 今日未實現損益變化（今日相對前一個有報價的交易日 pnl 差）
   * 無法推算時為 null（例如尚無今日行情或僅有一日資料）
   */
  dailyUnrealizedPnl: number | null;
  /** 日未實現計算時，是否有基金淨值非今日 */
  hasStaleFundNavOnDaily: boolean;
  saleCount: number;
  stockValue: number;
  fundValue: number;
  propertyValue: number;
  holdingCount: number;
}

/** 新增持倉表單 payload（尚未含 id / 時間戳） */
export interface CreateHoldingInput {
  assetType: AssetType;
  name: string;
  symbol: string;
  market?: StockMarket;
  buyPrice: number;
  quantity: number;
  buyDate: string;
}

/** 編輯持倉（保留 id、現價與價格歷史） */
export interface EditHoldingInput extends CreateHoldingInput {
  id: string;
}

/** 賣出持倉（部分賣出減少數量；全部賣出則移除持倉） */
export interface SellHoldingInput {
  id: string;
  /** 賣出股數或單位數 */
  quantity: number;
  /** 賣出成交價（元/股或元/單位） */
  sellPrice: number;
  /** 賣出日期 ISO YYYY-MM-DD */
  sellDate: string;
}
