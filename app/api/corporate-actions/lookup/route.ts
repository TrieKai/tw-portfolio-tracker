import { NextResponse } from "next/server";
import { z } from "zod";
import { lookupCorporateActions } from "@/lib/corporate-actions/fetcher";
import type { CorporateActionLookupResponse } from "@/lib/corporate-actions/types";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  holdingId: z.string().min(1),
  symbol: z.string().min(1),
  market: z.enum(["tse", "otc"]).optional(),
  buyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const requestSchema = z.object({
  items: z.array(itemSchema).max(50),
});

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json<CorporateActionLookupResponse>(
        {
          success: false,
          error: "查詢參數格式錯誤",
          code: "BAD_REQUEST",
          suggestion: "請確認持倉代號、櫃別與買入日期",
        },
        { status: 400 }
      );
    }

    const events = await lookupCorporateActions(parsed.data.items);
    return NextResponse.json<CorporateActionLookupResponse>({
      success: true,
      events,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json<CorporateActionLookupResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "公司行動查詢失敗",
        code: "UPSTREAM_ERROR",
        suggestion: "請稍後重試，或先用編輯持倉手動調整",
      },
      { status: 502 }
    );
  }
}
