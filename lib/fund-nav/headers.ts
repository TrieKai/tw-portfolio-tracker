/** 集保中心 API 共用請求標頭（降低 WAF 阻擋） */
export const FUNDCLEAR_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://www.fundclear.com.tw",
  Referer: "https://www.fundclear.com.tw/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
