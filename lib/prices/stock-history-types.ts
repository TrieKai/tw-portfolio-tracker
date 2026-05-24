/** 股票歷史收盤價（標準化） */
export interface StockPriceHistoryPoint {
  date: string;
  price: number;
}

export interface StockPriceHistoryData {
  symbol: string;
  market: "tse" | "otc";
  startDate: string;
  endDate: string;
  points: StockPriceHistoryPoint[];
}
