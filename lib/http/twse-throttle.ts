/**
 * TWSE 請求節流：同一 Node 程序內串行化外部請求，避免短時間大量呼叫被限流。
 */

import { fetchWithRetry, type FetchWithRetryOptions } from "./fetch-with-retry";

const MIN_GAP_MS = 600;

let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在全域佇列中執行 TWSE fetch，並確保相鄰兩次請求至少間隔 MIN_GAP_MS。
 */
export function throttledTwseFetch(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const run = async (): Promise<Response> => {
    const now = Date.now();
    const wait = Math.max(0, MIN_GAP_MS - (now - lastRequestAt));
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
    return fetchWithRetry(url, {
      retryableStatuses: [403, 408, 429, 500, 502, 503, 504],
      ...options,
    });
  };

  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}
