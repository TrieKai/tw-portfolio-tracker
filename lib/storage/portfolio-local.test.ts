import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTFOLIO_STORAGE_KEY } from "@/lib/portfolio/constants";
import { addHolding, commitPortfolio, loadPortfolio } from "@/lib/storage/portfolio-store";

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
});
