import { NextResponse } from "next/server";
import { z } from "zod";
import { updatePrice, UpdatePriceError } from "@/lib/prices/update-price";
import {
  MAX_BATCH_SIZE,
  type BatchUpdateItemResult,
  type BatchUpdateResponse,
} from "@/lib/types/price-api";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  holdingId: z.string().min(1),
  assetType: z.enum(["stock", "fund"]),
  symbol: z.string().trim().min(1),
  market: z.enum(["tse", "otc"]).optional(),
  name: z.string().trim().optional(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(MAX_BATCH_SIZE),
});

/**
 * POST /api/prices/batch
 * 批次更新多筆持倉價格；採循序執行以降低同時 timeout 風險。
 * 部分失敗仍回傳 200，由 results[].ok 區分。
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

  const results: BatchUpdateItemResult[] = [];

  for (const item of parsed.data.items) {
    try {
      const data = await updatePrice({
        assetType: item.assetType,
        symbol: item.symbol,
        market: item.market,
        name: item.name,
      });
      results.push({
        holdingId: item.holdingId,
        symbol: item.symbol,
        assetType: item.assetType,
        ok: true,
        data,
      });
    } catch (error) {
      const message =
        error instanceof UpdatePriceError
          ? error.message
          : error instanceof Error
            ? error.message
            : "更新失敗";
      const code =
        error instanceof UpdatePriceError ? error.code : "UNKNOWN";
      results.push({
        holdingId: item.holdingId,
        symbol: item.symbol,
        assetType: item.assetType,
        ok: false,
        error: message,
        code,
      });
    }
  }

  const payload: BatchUpdateResponse = {
    success: results.some((r) => r.ok),
    results,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
