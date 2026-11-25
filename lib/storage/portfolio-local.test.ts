import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTFOLIO_STORAGE_KEY } from "@/lib/portfolio/constants";
import { addHolding, commitPortfolio, loadPortfolio } from "@/lib/storage/portfolio-store";
import { addLoan, editLoan, restartLoan, setLoanStatus } from "@/lib/storage/loan-store";
import { defaultPortfolioStorage } from "@/lib/storage/parse-portfolio";
import { buildDailyInvestmentFinancingCosts, calculatePortfolioLoanSummary } from "@/lib/loans/calculations";
import { computePortfolioExposure } from "@/lib/portfolio/exposure";

function setupStorage() {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
  };
  let queue = Promise.resolve();
  const request = <T>(_name: string, update: () => T) => {
    const result = queue.then(update);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { locks: { request } });
  return storage;
}

const addStock = (symbol: string) => (latest: ReturnType<typeof loadPortfolio>) => addHolding(latest, {
  assetType: "stock",
  name: symbol,
  symbol,
  quantity: 1,
  buyPrice: 100,
  buyDate: "2026-11-01",
});

afterEach(() => vi.unstubAllGlobals());

describe("local portfolio writes", () => {
  it("applies simultaneous changes on the latest committed state", async () => {
    setupStorage();
    const publish = vi.fn();
    await Promise.all([
      commitPortfolio(addStock("2330"), publish),
      commitPortfolio(addStock("2317"), publish),
    ]);

    expect(loadPortfolio().holdings.map((holding) => holding.symbol)).toEqual(["2330", "2317"]);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("retains the last saved data after quota failure and allows retry", async () => {
    const storage = setupStorage();
    const publish = vi.fn();
    await commitPortfolio(addStock("2330"), publish);
    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await expect(commitPortfolio(addStock("2317"), publish)).rejects.toThrow("Quota exceeded");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(loadPortfolio().holdings.map((holding) => holding.symbol)).toEqual(["2330"]);
    await commitPortfolio(addStock("2317"), publish);
    expect(loadPortfolio().holdings).toHaveLength(2);
  });

  it("keeps malformed data intact until the user explicitly replaces it", async () => {
    const storage = setupStorage();
    storage.setItem(PORTFOLIO_STORAGE_KEY, "invalid json");
    const publish = vi.fn();

    await expect(commitPortfolio(addStock("2330"), publish)).rejects.toThrow();
    expect(storage.getItem(PORTFOLIO_STORAGE_KEY)).toBe("invalid json");
    expect(publish).not.toHaveBeenCalled();
    await commitPortfolio(addStock("2330"), publish, true);
    expect(loadPortfolio().holdings[0].symbol).toBe("2330");
  });

  function overlappingLoans() {
    const terms = { name: "測試貸款", loanType: "revolving_credit", purpose: "investment", investmentUsePercent: 100,
      rateType: "floating", repaymentMethod: "revolving", openingBalance: 100_000, annualInterestRate: 3,
      trackingStartDate: "2026-11-02", dataQuality: "complete" } as const;
    const initial = addLoan(defaultPortfolioStorage(), terms, "2026-11-02T00:00:00.000Z");
    const id = initial.loans[0].id;
    const closed = setLoanStatus(initial, id, "paid_off", "2026-11-06", "2026-11-07T00:00:00.000Z");
    const renewed = restartLoan(closed, id, { ...terms, trackingStartDate: "2026-11-10", openingBalance: 50_000 }, "2026-11-11T00:00:00.000Z");
    return {
      ...renewed,
      loans: [{ ...closed.loans[0], closedAt: "2026-11-16", statusUpdatedAt: "2026-11-19T00:00:00.000Z" }, renewed.loans[1]],
      loanRevisions: [{ id: "prior-closure", loanId: id, previous: closed.loans[0], correctedAt: "2026-11-19T00:00:00.000Z" }],
    };
  }

  it("recovers a compatible closure from a stored revision without writing during load", () => {
    const storage = setupStorage();
    const raw = JSON.stringify(overlappingLoans());
    storage.setItem(PORTFOLIO_STORAGE_KEY, raw);
    const loaded = loadPortfolio();
    expect(loaded.loans[0].closedAt).toBe("2026-11-06");
    expect(calculatePortfolioLoanSummary(loaded.loans, { asOfDate: "2026-11-12" }).totalDebt).toBe(50_000);
    expect(storage.getItem(PORTFOLIO_STORAGE_KEY)).toBe(raw);
  });

  it("preserves unresolved phases for correction while accounting for unrelated loans", async () => {
    const storage = setupStorage();
    const overlapping = overlappingLoans();
    const loan = overlapping.loans[1];
    const other = { ...loan, id: "unrelated", restartedFromLoanId: undefined, openingBalance: 20_000 };
    const raw = JSON.stringify({ ...overlapping, loanRevisions: [], loans: [...overlapping.loans, other] });
    storage.setItem(PORTFOLIO_STORAGE_KEY, raw);
    const loaded = loadPortfolio();
    expect(loaded.loans).toHaveLength(3);
    expect(loaded.loans[0].closedAt).toBe("2026-11-16");
    expect(calculatePortfolioLoanSummary(loaded.loans, { asOfDate: "2026-11-12" }).totalDebt).toBe(20_000);
    expect(computePortfolioExposure([], {}, loaded.loans, "2026-11-12").totalLiabilities).toBe(20_000);
    expect(buildDailyInvestmentFinancingCosts(loaded.loans, "2026-11-12", "2026-11-12")["2026-11-12"])
      .toBeCloseTo(20_000 * 0.03 / 365, 5);
    expect(storage.getItem(PORTFOLIO_STORAGE_KEY)).toBe(raw);

    await commitPortfolio((latest) => editLoan(latest, { ...loan, trackingStartDate: "2026-11-17" }), vi.fn());
    expect(calculatePortfolioLoanSummary(loadPortfolio().loans, { asOfDate: "2026-11-25" }).totalDebt).toBe(70_000);
  });
});
