import { getSessionUserFromRequest } from "@/lib/auth/session-user-id";
import {
  createCloudEnvelope,
  getCloudPortfolio,
  isKvConfigured,
  writeCloudPortfolioIfCurrent,
} from "@/lib/storage/cloud-portfolio";
import { decodePortfolioStorage } from "@/lib/storage/parse-portfolio";
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
  const decoded = decodePortfolioStorage(rawPortfolio);
  if (!decoded.ok) return error(400, "INVALID_BODY", decoded.error);

  const suppliedVersion =
    body &&
    typeof body === "object" &&
    "updatedAt" in body
      ? body.updatedAt
      : undefined;
  if (suppliedVersion !== undefined && suppliedVersion !== null && typeof suppliedVersion !== "string") {
    return error(400, "INVALID_BODY", "雲端資料版本格式無效");
  }

  try {
    const existing = await getCloudPortfolio(user.id, user.email);
    const currentVersion = existing?.updatedAt ?? null;
    const expectedVersion = suppliedVersion === undefined ? currentVersion : suppliedVersion;
    const envelope = createCloudEnvelope(decoded.portfolio, currentVersion);
    if (expectedVersion !== currentVersion ||
        !await writeCloudPortfolioIfCurrent(user.id, envelope, expectedVersion, user.email)) {
      const conflict: PortfolioSyncGetResponse = {
        success: true,
        data: expectedVersion !== currentVersion
          ? existing
          : await getCloudPortfolio(user.id, user.email),
      };
      return NextResponse.json(conflict, { status: 409 });
    }

    const res: PortfolioSyncPutResponse = {
      success: true,
      updatedAt: envelope.updatedAt,
    };
    return NextResponse.json(res);
  } catch {
    return error(500, "KV_ERROR", "寫入雲端資料失敗，請稍後再試");
  }
}
