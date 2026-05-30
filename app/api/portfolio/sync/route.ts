import { getSessionUserFromRequest } from "@/lib/auth/session-user-id";
import {
  createCloudEnvelope,
  getCloudPortfolio,
  isKvConfigured,
  setCloudPortfolio,
} from "@/lib/storage/cloud-portfolio";
import { normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";
import type {
  PortfolioSyncErrorResponse,
  PortfolioSyncGetResponse,
  PortfolioSyncPutResponse,
} from "@/lib/types/portfolio-sync";
import { NextResponse } from "next/server";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

function error(
  status: number,
  code: PortfolioSyncErrorResponse["code"],
  errorMessage: string
) {
  const body: PortfolioSyncErrorResponse = {
    success: false,
    error: errorMessage,
    code,
  };
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    return error(401, "UNAUTHORIZED", "請先登入 Google 帳號");
  }

  if (!isKvConfigured()) {
    return error(
      503,
      "KV_NOT_CONFIGURED",
      "雲端同步尚未設定：請在 Vercel 綁定 Upstash Redis，並設定 KV_REST_API_* 或 UPSTASH_REDIS_REST_*"
    );
  }

  try {
    const data = await getCloudPortfolio(user.id, user.email);
    const body: PortfolioSyncGetResponse = { success: true, data };
    return NextResponse.json(body);
  } catch {
    return error(500, "KV_ERROR", "讀取雲端資料失敗，請稍後再試");
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUserFromRequest(request);
  if (!user) {
    return error(401, "UNAUTHORIZED", "請先登入 Google 帳號");
  }

  if (!isKvConfigured()) {
    return error(
      503,
      "KV_NOT_CONFIGURED",
      "雲端同步尚未設定：請在 Vercel 綁定 Upstash Redis，並設定 KV_REST_API_* 或 UPSTASH_REDIS_REST_*"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "INVALID_BODY", "請求格式錯誤");
  }

  const rawPortfolio =
    body && typeof body === "object" && "portfolio" in body
      ? (body as { portfolio: unknown }).portfolio
      : undefined;
  const portfolio = normalizePortfolioStorage(rawPortfolio);

  if (!portfolio) {
    return error(400, "INVALID_BODY", "投資組合資料格式無效");
  }

  const clientUpdatedAt =
    body &&
    typeof body === "object" &&
    "updatedAt" in body &&
    typeof (body as { updatedAt: unknown }).updatedAt === "string"
      ? (body as { updatedAt: string }).updatedAt
      : undefined;

  try {
    const existing = await getCloudPortfolio(user.id, user.email);
    if (
      existing &&
      clientUpdatedAt &&
      clientUpdatedAt < existing.updatedAt
    ) {
      const conflict: PortfolioSyncGetResponse = {
        success: true,
        data: existing,
      };
      return NextResponse.json(conflict, { status: 409 });
    }

    const envelope = createCloudEnvelope(portfolio);
    await setCloudPortfolio(user.id, envelope, user.email);
    const res: PortfolioSyncPutResponse = {
      success: true,
      updatedAt: envelope.updatedAt,
    };
    return NextResponse.json(res);
  } catch {
    return error(500, "KV_ERROR", "寫入雲端資料失敗，請稍後再試");
  }
}
