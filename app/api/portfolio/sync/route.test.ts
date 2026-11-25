import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import type { CloudPortfolioEnvelope } from "@/lib/types/portfolio-sync";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  compareAndWrite: vi.fn(),
}));
vi.mock("@/lib/auth/session-user-id", () => ({ getSessionUserFromRequest: mocks.session }));
vi.mock("@/lib/storage/cloud-portfolio", () => ({
  createCloudEnvelope: (portfolio: CloudPortfolioEnvelope["portfolio"]) => ({
    portfolio, updatedAt: "2026-11-25T08:01:00Z",
  }),
  getCloudPortfolio: mocks.read,
  writeCloudPortfolioIfCurrent: mocks.compareAndWrite,
  isKvConfigured: () => true,
}));

import { PUT } from "./route";

const portfolio = defaultPortfolioStorage();
const existing = { portfolio, updatedAt: "2026-11-25T08:00:00Z" };

function update(updatedAt: string | null) {
  return PUT(new Request("http://localhost/api/portfolio/sync", {
    method: "PUT",
    body: JSON.stringify({ portfolio, updatedAt }),
  }));
}

describe("雲端寫入版本檢查", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ id: "test-user" });
  });

  it("第一次上傳期間若出現另一份資料，回傳衝突而非覆蓋", async () => {
    mocks.read.mockResolvedValue(existing);
    const response = await update(null);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ data: existing });
    expect(mocks.compareAndWrite).not.toHaveBeenCalled();
  });

  it("讀取版本後有別台裝置先寫入時，回傳當時最新資料", async () => {
    const newer = { ...existing, updatedAt: "2026-11-25T08:00:30Z" };
    mocks.read.mockResolvedValueOnce(existing).mockResolvedValueOnce(newer);
    mocks.compareAndWrite.mockResolvedValue(false);
    const response = await update(existing.updatedAt);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ data: newer });
    expect(mocks.compareAndWrite).toHaveBeenCalledWith("test-user", expect.any(Object), existing.updatedAt, undefined);
  });

  it("只有具有相同版本的登入使用者可以更新資料", async () => {
    mocks.read.mockResolvedValue(existing);
    mocks.compareAndWrite.mockResolvedValue(true);
    expect((await update(existing.updatedAt)).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await update(existing.updatedAt)).status).toBe(401);
    expect(mocks.compareAndWrite).toHaveBeenCalledTimes(1);
  });

  it("以格式錯誤拒絕損毀的紀錄，並在讀寫雲端之前回報位置", async () => {
    const response = await PUT(new Request("http://localhost/api/portfolio/sync", {
      method: "PUT", body: JSON.stringify({ portfolio: { ...portfolio, holdings: [null] } }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: "INVALID_BODY", error: expect.stringContaining("holdings[0]") });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.compareAndWrite).not.toHaveBeenCalled();
  });
});
