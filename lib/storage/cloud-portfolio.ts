import { createClient } from "@vercel/kv";
import type { CloudPortfolioEnvelope } from "@/lib/types/portfolio-sync";
import { normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";
import { isRecord } from "@/lib/storage/portfolio-shape";
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

/** 讀取所有可能 key，回傳 updatedAt 最新的一份 */
export async function getCloudPortfolio(
  userId: string,
  email?: string | null
): Promise<CloudPortfolioEnvelope | null> {
  const kv = getKvClient();
  const copies: { updatedAt: string; portfolio: unknown }[] = [];

  for (const key of portfolioKvKeys(userId, email)) {
    const raw = await kv.get<unknown>(key);
    if (raw === null) continue;
    if (!isRecord(raw) || typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) {
      throw new Error("雲端資料版本無法讀取");
    }
    copies.push({ updatedAt: raw.updatedAt, portfolio: raw.portfolio });
  }

  copies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = copies[0]?.updatedAt;
  if (!latest) return null;
  for (const copy of copies) {
    if (copy.updatedAt !== latest) break;
    const portfolio = normalizePortfolioStorage(copy.portfolio);
    if (portfolio) return { updatedAt: latest, portfolio };
  }
  // 讀不到最新的資料時保留原狀，避免把損毀的資料當作首次同步。
  throw new Error("雲端投資組合資料無法讀取");
}

const WRITE_IF_CURRENT = `
local latestVersion = ''
for _, key in ipairs(KEYS) do
  local raw = redis.call('GET', key)
  if raw then
    local ok, envelope = pcall(cjson.decode, raw)
    if ok and type(envelope) == 'table' and type(envelope.portfolio) == 'table'
        and type(envelope.updatedAt) == 'string' and envelope.updatedAt > latestVersion then
      latestVersion = envelope.updatedAt
    end
  end
end
if latestVersion ~= ARGV[1] then return 0 end
local entries = {}
for _, key in ipairs(KEYS) do
  table.insert(entries, key)
  table.insert(entries, ARGV[2])
end
redis.call('MSET', unpack(entries))
return 1
`;

/** 版本比對與相容鍵寫入一起執行，避免兩台裝置同時覆蓋彼此。 */
export async function writeCloudPortfolioIfCurrent(
  userId: string,
  envelope: CloudPortfolioEnvelope,
  expectedVersion: string | null,
  email?: string | null
): Promise<boolean> {
  const kv = getKvClient();
  const result = await kv.eval<string[], number>(
    WRITE_IF_CURRENT,
    portfolioKvKeys(userId, email),
    [expectedVersion ?? "", JSON.stringify(envelope)]
  );
  return result === 1;
}

export function createCloudEnvelope(
  portfolio: CloudPortfolioEnvelope["portfolio"],
  previousVersion?: string | null,
): CloudPortfolioEnvelope {
  const previousTime = previousVersion ? Date.parse(previousVersion) : NaN;
  return {
    updatedAt: new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString(),
    portfolio,
  };
}
