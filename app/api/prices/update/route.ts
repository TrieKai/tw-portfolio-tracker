import { NextResponse } from "next/server";
import { z } from "zod";
import {
  updatePrice,
  UpdatePriceError,
} from "@/lib/prices/update-price";
import type { UpdatePriceError as ApiError } from "@/lib/types/price-api";

/** Vercel Hobby 預設 10s；Pro 可調高。單筆更新應在數秒內完成。 */
export const maxDuration = 25;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetType: z.enum(["stock", "fund"]),
  symbol: z.string().trim().min(1),
  market: z.enum(["tse", "otc"]).optional(),
  name: z.string().trim().optional(),
  skipCache: z.boolean().optional(),
});

const MANUAL_SUGGESTION =
  "自動更新失敗，請在持倉列表手動輸入最新價格或淨值。";

function fail(
  payload: ApiError,
  status: number
): NextResponse<ApiError> {
  return NextResponse.json(payload, { status });
}

/**
 * POST /api/prices/update
 * 統一更新單一股票或基金價格（避開瀏覽器 CORS）
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(
      { success: false, error: "Request body 必須為有效 JSON", code: "INVALID_BODY" },
      400
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      {
        success: false,
        error: parsed.error.errors.map((e) => e.message).join("；"),
        code: "VALIDATION_ERROR",
      },
      400
    );
  }

  const { assetType, symbol, market, name, skipCache } = parsed.data;

  try {
    const data = await updatePrice({
      assetType,
      symbol,
      market,
      name,
      skipCache,
    });
    return NextResponse.json(data, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[prices/update]", { assetType, symbol, error });

    if (error instanceof UpdatePriceError) {
      const statusMap: Record<string, number> = {
        STOCK_NOT_FOUND: 404,
        FUND_NOT_FOUND: 404,
        VALIDATION_ERROR: 400,
        TIMEOUT: 504,
        UPSTREAM_HTTP_ERROR: 502,
      };
      return fail(
        {
          success: false,
          error: error.message,
          code: error.code,
          suggestion: MANUAL_SUGGESTION,
        },
        statusMap[error.code] ?? 502
      );
    }

    return fail(
      {
        success: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        code: "INTERNAL_ERROR",
        suggestion: MANUAL_SUGGESTION,
      },
      500
    );
  }
}

export async function GET() {
  return fail(
    { success: false, error: "僅支援 POST", code: "METHOD_NOT_ALLOWED" },
    405
  );
}
