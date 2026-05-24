import { NextResponse } from "next/server";
import { z } from "zod";
import { getCachedFundNav, setCachedFundNav } from "@/lib/fund-nav/cache";
import { fetchFundNav, FundNavFetchError } from "@/lib/fund-nav/fetcher";
import type { FundNavErrorResponse } from "@/lib/fund-nav/types";

/**
 * Vercel Serverless 設定
 * - maxDuration：限制函式最長執行時間（秒）
 * - dynamic：強制動態路由，避免 build 時被靜態化
 */
export const maxDuration = 25;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  fundCode: z
    .string({ required_error: "fundCode 為必填欄位" })
    .trim()
    .min(1, "fundCode 不可為空")
    .regex(/^\d+$/, "fundCode 應為數字代碼，例如 18480065"),
  fundName: z.string().trim().optional(),
});

const MANUAL_FALLBACK_SUGGESTION =
  "自動抓取失敗，請改用手動輸入淨值與淨值日期，或稍後再試。";

function errorResponse(
  payload: FundNavErrorResponse,
  status: number
): NextResponse<FundNavErrorResponse> {
  return NextResponse.json(payload, { status });
}

/**
 * POST /api/fund-nav
 *
 * 接收 fundCode（必填）與 fundName（可選），
 * 向集保中心查詢最新淨值並回傳標準化 JSON。
 *
 * @example
 * POST /api/fund-nav
 * { "fundCode": "18480065" }
 */
export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return errorResponse(
      {
        error: "Request body 必須為有效 JSON",
        code: "INVALID_REQUEST_BODY",
      },
      400
    );
  }

  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join("；");
    return errorResponse(
      {
        error: message,
        code: "VALIDATION_ERROR",
      },
      400
    );
  }

  const { fundCode, fundName } = parsed.data;

  try {
    // 1. 先查快取（memory → Vercel KV）
    const cached = await getCachedFundNav(fundCode);
    if (cached) {
      return NextResponse.json(
        { success: true, data: cached, source: "cache" },
        {
          status: 200,
          headers: {
            "Cache-Control": "private, max-age=300",
            "X-Cache": "HIT",
          },
        }
      );
    }

    // 2. 向集保中心抓取（含 retry + timeout）
    const data = await fetchFundNav(fundCode, fundName);

    // 3. 寫入快取供後續請求使用
    await setCachedFundNav(fundCode, data);

    return NextResponse.json(
      { success: true, data, source: "fundclear" },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=300",
          "X-Cache": "MISS",
        },
      }
    );
  } catch (error) {
    console.error("[fund-nav] fetch failed:", { fundCode, error });

    if (error instanceof FundNavFetchError) {
      const statusMap: Record<string, number> = {
        FUND_NOT_FOUND: 404,
        VALIDATION_ERROR: 400,
        TIMEOUT: 504,
        UPSTREAM_HTTP_ERROR: 502,
      };

      return errorResponse(
        {
          error: error.message,
          code: error.code,
          suggestion: MANUAL_FALLBACK_SUGGESTION,
          ...(error.statusCode ? { details: `upstream status: ${error.statusCode}` } : {}),
        },
        statusMap[error.code] ?? 502
      );
    }

    return errorResponse(
      {
        error: error instanceof Error ? error.message : "抓取基金淨值時發生未知錯誤",
        code: "INTERNAL_ERROR",
        suggestion: MANUAL_FALLBACK_SUGGESTION,
      },
      500
    );
  }
}

/** 僅允許 POST，其他 method 回傳 405 */
export async function GET() {
  return errorResponse(
    {
      error: "此端點僅支援 POST 請求",
      code: "METHOD_NOT_ALLOWED",
    },
    405
  );
}
