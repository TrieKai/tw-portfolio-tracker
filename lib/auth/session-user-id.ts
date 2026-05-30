import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

/** 從 Route Handler 請求的 cookie 解析登入使用者 id（Google sub） */
export async function getSessionUserIdFromRequest(
  request: Request
): Promise<string | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const token = await getToken({
    req: request as NextRequest,
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  });

  return token?.sub ?? null;
}
