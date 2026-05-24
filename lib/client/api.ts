import type { FundNavApiResponse } from "./types";

export async function fetchFundNav(
  fundCode: string,
  fundName?: string
): Promise<FundNavApiResponse> {
  const res = await fetch("/api/fund-nav", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fundCode, ...(fundName ? { fundName } : {}) }),
  });

  const data = (await res.json()) as FundNavApiResponse;

  if (!res.ok) {
    return {
      error: "error" in data ? data.error : "查詢失敗",
      code: "code" in data ? data.code : "UNKNOWN",
      suggestion: "suggestion" in data ? data.suggestion : undefined,
      details: "details" in data ? data.details : undefined,
    };
  }

  return data;
}
