/** 保留已核對的交易，重匯舊備份時能辨認先前排除的紀錄。 */
export interface RecordImportReview {
  id: string;
  reviewedAt: string;
  includedIds: string[];
  excludedIds: string[];
}
