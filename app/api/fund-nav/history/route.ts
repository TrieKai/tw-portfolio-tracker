import { NextResponse } from "next/server";
import { z } from "zod";
import { chartRangeToFundclearDates } from "@/lib/fund-nav/date-utils";
import {
  fetchFundNavHistory,
  type FetchFundNavHistoryParams,
} from "@/lib/fund-nav/history-fetcher";
import { FundNavFetchError } from "@/lib/fund-nav/fetcher";
import type { FundNavErrorResponse } from "@/lib/fund-nav/types";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    fundCode: z
      .string()
      .trim()
      .min(1)
      .regex(/^\d+$/, "fundCode 應為數字"),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    /** 與 startDate/endDate 二擇一：由伺服器計算集保日期 */
    range: z
      .enum(["7d", "30d", "2m", "3m", "1q", "1y", "ytd", "all"])
      .optional(),
    buyDate: z.string().trim().optional(),
  })
  .refine(
    (d) =>
      (d.startDate && d.endDate) ||
      d.range !== undefined,
    { message: "請提供 startDate+endDate，或 range" }
  );

function errorResponse(
  payload: FundNavErrorResponse,
  status: number
): NextResponse<FundNavErrorResponse> {
  return NextResponse.json(payload, { status });
}

/**
 * POST /api/fund-nav/history
 *
 * 查詢境內基金歷史淨值（集保 query-nav-value/picture）
 *
 * @example
 * { "fundCode": "18480065", "startDate": "2026/02/24", "endDate": "2026/05/23" }
 * @example
 * { "fundCode": "18480065", "range": "30d", "buyDate": "2025-01-01" }
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(
      { error: "Request body 必須為有效 JSON", code: "INVALID_BODY" },
      400
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      {
        error: parsed.error.errors.map((e) => e.message).join("；"),
        code: "VALIDATION_ERROR",
      },
      400
    );
  }

  const { fundCode, startDate, endDate, range, buyDate } = parsed.data;

  let params: FetchFundNavHistoryParams;

  if (range) {
    const dates = chartRangeToFundclearDates(range, { buyDate });
    params = {
      fundCode,
      startDate: dates.startDate,
      endDate: dates.endDate,
    };
  } else {
    params = {
      fundCode,
      startDate: startDate!,
      endDate: endDate!,
    };
  }

  try {
    const data = await fetchFundNavHistory(params);
    return NextResponse.json(
      { success: true, data },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=3600" },
      }
    );
  } catch (error) {
    console.error("[fund-nav/history]", { fundCode, error });

    if (error instanceof FundNavFetchError) {
      const statusMap: Record<string, number> = {
        VALIDATION_ERROR: 400,
        NO_HISTORY_DATA: 404,
        TIMEOUT: 504,
        UPSTREAM_HTTP_ERROR: 502,
      };
      return errorResponse(
        {
          error: error.message,
          code: error.code,
        },
        statusMap[error.code] ?? 502
      );
    }

    return errorResponse(
      {
        error: error instanceof Error ? error.message : "未知錯誤",
        code: "INTERNAL_ERROR",
      },
      500
    );
  }
}

export async function GET() {
  return errorResponse(
    { error: "僅支援 POST", code: "METHOD_NOT_ALLOWED" },
    405
  );
}
