/**
 * 解析 Upstash / Vercel Redis 連線設定。
 * Vercel 整合可能注入 KV_* 或 UPSTASH_REDIS_*，需兩者皆支援。
 */
export function getKvRestConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) return null;
  return { url, token };
}

export function isKvConfigured(): boolean {
  return getKvRestConfig() !== null;
}
