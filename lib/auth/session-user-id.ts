import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export interface SessionUserIdentity {
  id: string;
  email?: string | null;
}

/** 從 Route Handler 請求的 cookie 解析登入使用者（Google sub + email） */
export async function getSessionUserFromRequest(
  request: Request
): Promise<SessionUserIdentity | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const token = await getToken({
    req: request as NextRequest,
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token?.sub) return null;

  return {
    id: token.sub,
    email: typeof token.email === "string" ? token.email : null,
  };
}

export async function getSessionUserIdFromRequest(
  request: Request
): Promise<string | null> {
  const user = await getSessionUserFromRequest(request);
  return user?.id ?? null;
}
