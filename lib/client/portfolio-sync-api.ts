import type { PortfolioStorage } from "@/lib/types/holding";
import type {
  CloudPortfolioEnvelope,
  PortfolioSyncErrorResponse,
  PortfolioSyncGetResponse,
  PortfolioSyncPutResponse,
} from "@/lib/types/portfolio-sync";

async function parseJson<T>(res: Response): Promise<T | PortfolioSyncErrorResponse> {
  return res.json() as Promise<T | PortfolioSyncErrorResponse>;
}

function isError(
  body: unknown
): body is PortfolioSyncErrorResponse {
  return (
    !!body &&
    typeof body === "object" &&
    "success" in body &&
    (body as PortfolioSyncErrorResponse).success === false
  );
}

export async function fetchCloudPortfolio(): Promise<
  | { ok: true; data: CloudPortfolioEnvelope | null }
  | { ok: false; error: string; code?: string; status: number }
> {
  const res = await fetch("/api/portfolio/sync", {
    method: "GET",
    credentials: "same-origin",
  });
  const body = await parseJson<PortfolioSyncGetResponse | PortfolioSyncErrorResponse>(
    res
  );

  if (!res.ok || isError(body)) {
    return {
      ok: false,
      error: isError(body) ? body.error : "讀取雲端資料失敗",
      code: isError(body) ? body.code : undefined,
      status: res.status,
    };
  }

  return { ok: true, data: body.data };
}

export async function pushCloudPortfolio(
  portfolio: PortfolioStorage,
  updatedAt?: string
): Promise<
  | { ok: true; updatedAt: string }
  | {
      ok: false;
      error: string;
      code?: string;
      status: number;
      remote?: CloudPortfolioEnvelope | null;
    }
> {
  const res = await fetch("/api/portfolio/sync", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ portfolio, updatedAt }),
  });

  const body = await parseJson<
    PortfolioSyncPutResponse | PortfolioSyncGetResponse | PortfolioSyncErrorResponse
  >(res);

  if (res.status === 409 && !isError(body) && "data" in body) {
    return {
      ok: false,
      error: "雲端已有較新的資料",
      status: 409,
      remote: (body as PortfolioSyncGetResponse).data,
    };
  }

  if (!res.ok || isError(body)) {
    return {
      ok: false,
      error: isError(body) ? body.error : "同步至雲端失敗",
      code: isError(body) ? body.code : undefined,
      status: res.status,
    };
  }

  return { ok: true, updatedAt: (body as PortfolioSyncPutResponse).updatedAt };
}
