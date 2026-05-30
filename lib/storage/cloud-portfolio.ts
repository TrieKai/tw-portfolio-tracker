import type { CloudPortfolioEnvelope } from "@/lib/types/portfolio-sync";
import {
  defaultPortfolioStorage,
  normalizePortfolioStorage,
} from "@/lib/storage/parse-portfolio";

const KV_KEY_PREFIX = "portfolio:user:";

export function portfolioKvKey(userId: string): string {
  return `${KV_KEY_PREFIX}${userId}`;
}

export function isKvConfigured(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

export async function getCloudPortfolio(
  userId: string
): Promise<CloudPortfolioEnvelope | null> {
  if (!isKvConfigured()) {
    throw new Error("KV_NOT_CONFIGURED");
  }

  const { kv } = await import("@vercel/kv");
  const raw = await kv.get<unknown>(portfolioKvKey(userId));
  if (!raw || typeof raw !== "object") return null;

  const envelope = raw as CloudPortfolioEnvelope;
  const portfolio = normalizePortfolioStorage(envelope.portfolio);
  if (!portfolio || typeof envelope.updatedAt !== "string") return null;

  return { updatedAt: envelope.updatedAt, portfolio };
}

export async function setCloudPortfolio(
  userId: string,
  envelope: CloudPortfolioEnvelope
): Promise<void> {
  if (!isKvConfigured()) {
    throw new Error("KV_NOT_CONFIGURED");
  }

  const portfolio = normalizePortfolioStorage(envelope.portfolio);
  if (!portfolio) {
    throw new Error("INVALID_PORTFOLIO");
  }

  const { kv } = await import("@vercel/kv");
  await kv.set(portfolioKvKey(userId), {
    updatedAt: envelope.updatedAt,
    portfolio,
  });
}

export function createCloudEnvelope(
  portfolio: CloudPortfolioEnvelope["portfolio"]
): CloudPortfolioEnvelope {
  return {
    updatedAt: new Date().toISOString(),
    portfolio: normalizePortfolioStorage(portfolio) ?? defaultPortfolioStorage(),
  };
}
