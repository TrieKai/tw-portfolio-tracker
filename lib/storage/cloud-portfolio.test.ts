import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudPortfolio } from "@/lib/storage/cloud-portfolio";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/kv", () => ({ createClient: () => ({ get }) }));
vi.mock("@/lib/storage/kv-config", () => ({ getKvRestConfig: () => ({ url: "https://example.invalid", token: "test" }) }));

describe("reading cloud copies", () => {
  const healthy = { updatedAt: "2026-11-25T01:00:00.000Z", portfolio: defaultPortfolioStorage() };
  const damaged = { ...healthy, portfolio: { version: 2, holdings: [null] } };

  beforeEach(() => get.mockReset());

  it("distinguishes missing data from a damaged portfolio", async () => {
    get.mockResolvedValueOnce(null);
    await expect(getCloudPortfolio("user")).resolves.toBeNull();
    get.mockResolvedValueOnce(damaged);
    await expect(getCloudPortfolio("user")).rejects.toThrow("雲端投資組合資料無法讀取");
  });

  it("reads the valid copy of the newest version when one matching copy is damaged", async () => {
    get.mockResolvedValueOnce(damaged).mockResolvedValueOnce(healthy);
    await expect(getCloudPortfolio("user", "user@example.invalid")).resolves.toMatchObject(healthy);
  });

  it("does not substitute an older copy for damaged newer data", async () => {
    get.mockResolvedValueOnce(healthy).mockResolvedValueOnce({ ...damaged, updatedAt: "2026-11-25T02:00:00.000Z" });
    await expect(getCloudPortfolio("user", "user@example.invalid")).rejects.toThrow("雲端投資組合資料無法讀取");
  });
});
