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

type CloudReadResult =
  | { ok: true; data: CloudPortfolioEnvelope | null }
  | { ok: false; error: string; code?: string; status: number };

type CloudWriteResult =
  | { ok: true; updatedAt: string }
  | {
      ok: false;
      error: string;
      code?: string;
      status: number;
      remote?: CloudPortfolioEnvelope | null;
    };

export async function fetchCloudPortfolio(): Promise<CloudReadResult> {
  try {
    return await readCloudPortfolio();
  } catch {
    return { ok: false, code: "NETWORK_ERROR", status: 0, error: "無法讀取雲端資料，請檢查網路後重試。" };
  }
}

async function readCloudPortfolio(): Promise<CloudReadResult> {
  const res = await fetch("/api/portfolio/sync", {
    method: "GET",
    credentials: "same-origin",
    signal: AbortSignal.timeout(25_000),
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
  updatedAt: string | null,
): Promise<CloudWriteResult> {
  try {
    return await writeCloudPortfolio(portfolio, updatedAt);
  } catch {
    return { ok: false, code: "NETWORK_ERROR", status: 0, error: "無法同步至雲端，變更已保存在本機。" };
  }
}

async function writeCloudPortfolio(portfolio: PortfolioStorage, updatedAt: string | null): Promise<CloudWriteResult> {
  const res = await fetch("/api/portfolio/sync", {
    method: "PUT",
    credentials: "same-origin",
    signal: AbortSignal.timeout(25_000),
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
