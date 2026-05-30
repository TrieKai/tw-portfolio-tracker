import { createClient } from "@vercel/kv";
import type { CloudPortfolioEnvelope } from "@/lib/types/portfolio-sync";
import {
  defaultPortfolioStorage,
  normalizePortfolioStorage,
} from "@/lib/storage/parse-portfolio";
import { getKvRestConfig } from "@/lib/storage/kv-config";

const KV_KEY_PREFIX = "portfolio:user:";

export { isKvConfigured } from "@/lib/storage/kv-config";

function getKvClient() {
  const config = getKvRestConfig();
  if (!config) {
    throw new Error("KV_NOT_CONFIGURED");
  }
  return createClient(config);
}

/** 以 email 與 Google sub 建立多個可能的 key（跨 OAuth 用戶端／舊資料相容） */
export function portfolioKvKeys(
  userId: string,
  email?: string | null
): string[] {
  const keys = new Set<string>();
  keys.add(`${KV_KEY_PREFIX}${userId}`);
  if (email) {
    const normalized = email.trim().toLowerCase();
    if (normalized) {
      keys.add(`${KV_KEY_PREFIX}email:${normalized}`);
    }
  }
  return [...keys];
}

export function portfolioKvKey(userId: string): string {
  return `${KV_KEY_PREFIX}${userId}`;
}

function parseEnvelope(raw: unknown): CloudPortfolioEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const envelope = raw as CloudPortfolioEnvelope;
  const portfolio = normalizePortfolioStorage(envelope.portfolio);
  if (!portfolio || typeof envelope.updatedAt !== "string") return null;
  return { updatedAt: envelope.updatedAt, portfolio };
}

/** 讀取所有可能 key，回傳 updatedAt 最新的一份 */
export async function getCloudPortfolio(
  userId: string,
  email?: string | null
): Promise<CloudPortfolioEnvelope | null> {
  const kv = getKvClient();
  let best: CloudPortfolioEnvelope | null = null;

  for (const key of portfolioKvKeys(userId, email)) {
    const raw = await kv.get<unknown>(key);
    const parsed = parseEnvelope(raw);
    if (!parsed) continue;
    if (!best || parsed.updatedAt > best.updatedAt) {
      best = parsed;
    }
  }

  return best;
}

/** 寫入所有可能 key，確保不同裝置／環境都能讀到同一份資料 */
export async function setCloudPortfolio(
  userId: string,
  envelope: CloudPortfolioEnvelope,
  email?: string | null
): Promise<void> {
  const portfolio = normalizePortfolioStorage(envelope.portfolio);
  if (!portfolio) {
    throw new Error("INVALID_PORTFOLIO");
  }

  const payload = {
    updatedAt: envelope.updatedAt,
    portfolio,
  };

  const kv = getKvClient();
  await Promise.all(
    portfolioKvKeys(userId, email).map((key) => kv.set(key, payload))
  );
}

export function createCloudEnvelope(
  portfolio: CloudPortfolioEnvelope["portfolio"]
): CloudPortfolioEnvelope {
  return {
    updatedAt: new Date().toISOString(),
    portfolio: normalizePortfolioStorage(portfolio) ?? defaultPortfolioStorage(),
  };
}
