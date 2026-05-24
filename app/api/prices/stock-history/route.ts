import { NextResponse } from "next/server";
import { z } from "zod";
import type { ChartRange } from "@/lib/portfolio/calculations";
import { chartRangeToIsoDates } from "@/lib/portfolio/chart-date-range";
import {
  fetchStockPriceHistory,
  StockHistoryFetchError,
} from "@/lib/prices/stock-history-fetcher";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    symbol: z.string().trim().min(1),
    market: z.enum(["tse", "otc"]).optional(),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    range: z
      .enum(["7d", "30d", "2m", "3m", "1q", "1y", "ytd", "all"])
      .optional(),
    buyDate: z.string().trim().optional(),
  })
  .refine(
    (d) => (d.startDate && d.endDate) || d.range !== undefined,
    { message: "請提供 startDate+endDate，或 range" }
  );

/**
 * POST /api/prices/stock-history
 * 上市股票歷史收盤價（TWSE 各日成交資訊）
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

  const { symbol, market, startDate, endDate, range, buyDate } = parsed.data;

  let isoStart = startDate;
  let isoEnd = endDate;
  if (range) {
    const dates = chartRangeToIsoDates(range as ChartRange, { buyDate });
    isoStart = dates.startDate;
    isoEnd = dates.endDate;
  }

  try {
    const data = await fetchStockPriceHistory({
      symbol,
      market,
      startDate: isoStart!,
      endDate: isoEnd!,
    });
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch (error) {
    console.error("[prices/stock-history]", { symbol, error });

    if (error instanceof StockHistoryFetchError) {
      const statusMap: Record<string, number> = {
        VALIDATION_ERROR: 400,
        OTC_NOT_SUPPORTED: 501,
        NO_HISTORY_DATA: 404,
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
        error: error instanceof Error ? error.message : "未知錯誤",
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
