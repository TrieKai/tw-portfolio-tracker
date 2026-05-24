import { NextResponse } from "next/server";
import { z } from "zod";
import {
  lookupInstrumentName,
  LookupInstrumentError,
  normalizeSymbolForAsset,
} from "@/lib/prices/lookup-instrument";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  assetType: z.enum(["stock", "fund"]),
  symbol: z.string().trim().min(1),
  market: z.enum(["tse", "otc"]).optional(),
});

/**
 * POST /api/instruments/lookup
 * 依股票代號或基金代碼查詢官方名稱（不寫入持倉）
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON", code: "INVALID_BODY" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.errors.map((e) => e.message).join("；"),
        code: "VALIDATION_ERROR",
      },
      { status: 400 }
    );
  }

  const { assetType, symbol, market } = parsed.data;

  try {
    const result = await lookupInstrumentName({ assetType, symbol, market });
    return NextResponse.json({
      success: true,
      data: {
        ...result,
        symbol: normalizeSymbolForAsset(assetType, result.symbol),
      },
    });
  } catch (error) {
    console.error("[instruments/lookup]", { assetType, symbol, error });

    if (error instanceof LookupInstrumentError) {
      const statusMap: Record<string, number> = {
        VALIDATION_ERROR: 400,
        STOCK_NOT_FOUND: 404,
        FUND_NOT_FOUND: 404,
        TIMEOUT: 504,
        UPSTREAM_HTTP_ERROR: 502,
      };
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status: statusMap[error.code] ?? 502 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "查詢失敗",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: "僅支援 POST", code: "METHOD_NOT_ALLOWED" },
    { status: 405 }
  );
}
