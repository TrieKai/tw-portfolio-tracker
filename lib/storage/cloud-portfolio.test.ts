import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudPortfolio } from "@/lib/storage/cloud-portfolio";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import { addLoan, restartLoan, setLoanStatus } from "@/lib/storage/loan-store";

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

  it("recovers a recorded closure when the stored loan phases overlap", async () => {
    const terms = {
      name: "雲端貸款", loanType: "revolving_credit", purpose: "investment", investmentUsePercent: 100,
      rateType: "floating", repaymentMethod: "revolving", openingBalance: 100_000, annualInterestRate: 3,
      trackingStartDate: "2026-11-02", dataQuality: "complete",
    } as const;
    const initial = addLoan(defaultPortfolioStorage(), terms, "2026-11-02T00:00:00Z");
    const loanId = initial.loans[0].id;
    const closed = setLoanStatus(initial, loanId, "paid_off", "2026-11-06", "2026-11-07T00:00:00Z");
    const previous = closed.loans[0];
    const renewed = restartLoan(closed, loanId, { ...terms, trackingStartDate: "2026-11-10", openingBalance: 50_000 }, "2026-11-11T00:00:00Z");
    const corrupted = { ...previous, closedAt: "2026-11-16", statusUpdatedAt: "2026-11-19T00:00:00Z" };
    get.mockResolvedValueOnce(JSON.parse(JSON.stringify({
      ...healthy,
      portfolio: {
        ...renewed,
        loans: [corrupted, renewed.loans[1]],
        loanRevisions: [{ id: "previous-closure", loanId, previous, correctedAt: "2026-11-19T00:00:00Z" }],
      },
    })));

    await expect(getCloudPortfolio("user")).resolves.toMatchObject({
      updatedAt: healthy.updatedAt,
      portfolio: {
        loans: [
          { id: loanId, status: "paid_off", closedAt: "2026-11-06", statusUpdatedAt: previous.statusUpdatedAt },
          { id: renewed.loans[1].id, restartedFromLoanId: loanId, status: "active", openingBalance: 50_000 },
        ],
      },
    });
  });
});
