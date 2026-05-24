/**
 * 通用 HTTP 抓取工具：Timeout + Retry + 指數退避
 * 供 TWSE、集保等外部 API 共用，符合 Vercel Serverless 短執行限制。
 */

export interface FetchWithRetryOptions {
  /** 單次請求 timeout（毫秒），預設 8 秒 */
  timeoutMs?: number;
  /** 最大嘗試次數（含首次），預設 3 */
  maxRetries?: number;
  /** 可重試的 HTTP 狀態碼 */
  retryableStatuses?: number[];
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}

export class FetchRetryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "FetchRetryError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 帶 abort timeout 的 fetch 封裝
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 8_000,
    maxRetries = 3,
    retryableStatuses = [408, 429, 500, 502, 503, 504],
    headers,
    method = "GET",
    body,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok && retryableStatuses.includes(response.status)) {
        if (attempt < maxRetries) {
          await sleep(300 * attempt);
          continue;
        }
        throw new FetchRetryError(
          `HTTP ${response.status}`,
          "UPSTREAM_HTTP_ERROR",
          response.status
        );
      }

      return response;
    } catch (error) {
      lastError = error;

      const isAbort =
        error instanceof DOMException && error.name === "AbortError";
      const isRetryable =
        isAbort ||
        (error instanceof FetchRetryError &&
          error.code === "UPSTREAM_HTTP_ERROR");

      if (attempt < maxRetries && isRetryable) {
        await sleep(300 * attempt);
        continue;
      }

      if (isAbort) {
        throw new FetchRetryError(
          `請求逾時（>${timeoutMs}ms）`,
          "TIMEOUT"
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new FetchRetryError("未知錯誤", "UNKNOWN");
}
