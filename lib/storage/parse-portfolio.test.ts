import { describe, expect, it, vi } from "vitest";
import { defaultPortfolioStorage, normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";
import { addHolding, applyCorporateAction, applyManualCorporateAction, sellHolding } from "@/lib/storage/portfolio-store";
import { applyImportMode, mergePortfolioStorage } from "@/lib/storage/portfolio-export";
import type { PortfolioStorage } from "@/lib/types/holding";

function legacyShareAdjustment(
  kind: "stock_dividend" | "capital_reduction", sellQuantity = 20, ratio = kind === "stock_dividend" ? 1.25 : 0.5, year = 2026
): PortfolioStorage {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(`${year}-11-04T08:00:00Z`));
    const opened = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "測試股票", buyDate: `${year}-11-03`, buyPrice: 100, quantity: 100,
    });
    const id = opened.holdings[0].id;
    const sellDate = `${year}-11-12`;
    const effectiveDate = `${year}-11-10`;
    vi.setSystemTime(new Date(`${year}-11-13T08:00:00Z`));
    const sold = sellHolding(opened, { id, quantity: sellQuantity, sellDate, sellPrice: 140, fee: 5, tax: 8 });
    vi.setSystemTime(new Date(`${year}-11-14T08:00:00Z`));
    // 舊版以成交後的餘量套用公司行動，但仍會調整生效日前的原始買入交易。
    const basis = { ...sold, sales: [], transactions: sold.transactions.filter((event) => event.type !== "sell") };
    const applied = kind === "stock_dividend"
      ? applyCorporateAction(basis, {
          id: "fixture-legacy-stock-dividend", holdingId: id, symbol: "2330", market: "tse", name: "測試股票",
          source: "twse", type: "stock_dividend", exDividendLabel: "除權", effectiveDate,
          stockDividendRatio: ratio - 1, subscriptionRatio: 0, autoApplicable: true,
        })
      : applyManualCorporateAction(basis, {
          holdingId: id, actionType: "capital_reduction", effectiveDate, adjustmentRatio: ratio, cashReturnPerShare: 30,
        });

    return {
      ...applied,
      sales: sold.sales,
      transactions: [...applied.transactions, ...sold.transactions.filter((event) => event.type === "sell")],
      corporateActions: applied.corporateActions.map((action) => ({ ...action, usesEffectiveDateShares: undefined })),
    };
  } finally {
    vi.useRealTimers();
  }
}

describe("normalizePortfolioStorage", () => {
  it.each([
    ["stock_dividend", 1.25, 105, 80, 1187],
    ["capital_reduction", 0.5, 30, 140, -13],
    ["capital_reduction", 1, 80, 70, 1387],
  ] as const)("repairs old %s at a ratio of %s from the audited trades", (kind, ratio, quantity, buyPrice, realizedPnl) => {
    const raw = legacyShareAdjustment(kind, 20, ratio);
    const repaired = normalizePortfolioStorage(JSON.parse(JSON.stringify(raw)))!;
    expect(repaired.holdings[0]).toMatchObject({ quantity, buyPrice });
    expect(repaired.sales[0]).toMatchObject({ quantity: 20, sellPrice: 140, fee: 5, tax: 8, buyPrice, realizedPnl });
    expect(repaired.corporateActions[0]).toMatchObject({ quantityBefore: 100, quantityAfter: quantity + 20 });
    if (kind === "capital_reduction") {
      expect(repaired.transactions.find((event) => event.type === "capital_return")?.amount).toBe(3000);
    }
    expect(repaired.transactions.filter((event) => event.type === "sell" || event.type === "buy"))
      .toEqual(raw.transactions.filter((event) => event.type === "sell" || event.type === "buy"));
    expect(normalizePortfolioStorage(repaired)).toEqual(repaired);
    expect(normalizePortfolioStorage(raw)).toEqual(repaired);
    expect(applyImportMode(defaultPortfolioStorage(), raw, "replace").holdings).toEqual(repaired.holdings);
    expect(mergePortfolioStorage(raw, repaired).sales).toEqual(repaired.sales);
  });

  it("keeps ambiguous prior adjustments and unrelated positions intact", () => {
    const raw = legacyShareAdjustment("stock_dividend");
    const noAudit = { ...raw, transactionRevisions: [] };
    const editedAfter = {
      ...raw, holdings: [{ ...raw.holdings[0], positionUpdatedAt: "2026-11-15T08:00:00Z" }],
    };
    const inconsistentSale = { ...raw, sales: [{ ...raw.sales[0], quantity: 21 }] };
    const inconsistentBasis = {
      ...raw, transactionRevisions: raw.transactionRevisions.map((revision) => ({
        ...revision, previous: { ...revision.previous, quantity: 120 },
      })),
    };
    for (const portfolio of [noAudit, editedAfter, inconsistentSale, inconsistentBasis, legacyShareAdjustment("capital_reduction", 60)]) {
      const normalized = normalizePortfolioStorage(portfolio)!;
      expect(normalized.holdings).toEqual(portfolio.holdings);
      expect(normalized.sales).toEqual(portfolio.sales);
      expect(normalized.corporateActions).toEqual(portfolio.corporateActions);
    }
  });

  it("replays a previously miscalculated reduction after a newer but earlier-effective distribution", () => {
    const raw = legacyShareAdjustment("capital_reduction");
    const holdingId = raw.holdings[0].id;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
      const withDistribution = applyCorporateAction(raw, {
        id: "fixture-legacy-earlier-stock-dividend", holdingId, symbol: "2330", market: "tse", name: "測試股票",
        source: "twse", type: "stock_dividend", exDividendLabel: "除權", effectiveDate: "2026-11-08",
        stockDividendRatio: 0.25, subscriptionRatio: 0, autoApplicable: true,
      });
      const corrected = normalizePortfolioStorage(withDistribution)!;
      expect(corrected.holdings[0]).toMatchObject({ quantity: 42.5, buyPrice: 100 });
      expect(corrected.corporateActions.find((record) => record.actionType === "capital_reduction")).toMatchObject({
        quantityBefore: 125, quantityAfter: 62.5, buyPriceBefore: 80, buyPriceAfter: 100,
      });
      expect(corrected.transactions.find((event) => event.type === "capital_return")?.amount).toBe(3750);
      expect(corrected.sales[0]).toMatchObject({ buyPrice: 100, realizedPnl: 787 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("corrects a known cash dividend in an archived summary without discarding its valuation", () => {
    const raw = legacyShareAdjustment("stock_dividend", 20, 1.25, 2022);
    const [event] = raw.corporateActions;
    const [buy] = raw.transactions;
    const date = event.effectiveDate;
    const repaired = normalizePortfolioStorage({
      ...raw,
      corporateActions: [{ ...event, actionType: "mixed", cashDividend: 2 }],
      transactions: [...raw.transactions, {
        id: "fixture-expired-cash-dividend", holdingId: event.holdingId, assetType: "stock", symbol: buy.symbol,
        name: buy.name, market: buy.market, type: "cash_dividend", date, corporateActionEventId: event.sourceEventId,
        amount: 192, fee: 0, tax: 0, quality: "complete", source: "corporate_action", createdAt: event.createdAt, updatedAt: event.createdAt,
      }],
      pnlTracking: { ...raw.pnlTracking, dailySummaries: {
        [date]: { date, pnl: 212, returnBase: 10000, returnRate: 2.12, quality: "complete", computedAt: event.createdAt },
      } },
    })!;
    expect(repaired.transactions.at(-1)).toMatchObject({ amount: 200 });
    expect(repaired.pnlTracking.dailySummaries[date].pnl).toBe(220);
    expect(repaired.pnlTracking.dailySummaries[date].returnRate).toBeCloseTo(2.2);
    expect(normalizePortfolioStorage(repaired)).toEqual(repaired);
  });

  it("records a valid closing sale when a legacy reduction left a false positive balance", () => {
    const raw = legacyShareAdjustment("capital_reduction", 50);
    const corrected = normalizePortfolioStorage(raw)!;
    expect(corrected.holdings).toHaveLength(0);
    expect(corrected.sales[0]).toMatchObject({ positionClosed: true, buyPrice: 140, realizedPnl: -13 });
    expect(corrected.transactions.find((event) => event.type === "capital_return")?.amount).toBe(3000);
  });

  it("loads a version 1 backup as version 2 without user re-entry", () => {
    const normalized = normalizePortfolioStorage({
      version: 1,
      holdings: [
        {
          id: "holding-1",
          assetType: "fund",
          name: "測試基金",
          symbol: "1234",
          buyPrice: 10,
          quantity: 100,
          buyDate: "2026-01-01",
          currentPrice: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
      priceHistory: {},
      sales: [],
      corporateActions: [],
      settings: { autoUpdateEnabled: false },
    });

    expect(normalized).toMatchObject({
      version: 2,
      transactions: [
        {
          type: "opening_balance",
          holdingId: "holding-1",
          quantity: 100,
          price: 12,
        },
      ],
      transactionRevisions: [],
      pnlTracking: { dailySummaries: {} },
    });
  });

  it("migrates aggregate liabilities and property mortgages once", () => {
    const normalized = normalizePortfolioStorage(
      {
        version: 2,
        holdings: [
          {
            id: "property-1",
            assetType: "property",
            name: "自住房",
            symbol: "HOME",
            buyPrice: 10_000_000,
            quantity: 1,
            buyDate: "2020-01-01",
            mortgageBalance: 6_000_000,
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        priceHistory: {},
        sales: [],
        corporateActions: [],
        transactions: [],
        transactionRevisions: [],
        pnlTracking: { startedAt: "", dailySummaries: {} },
        settings: { autoUpdateEnabled: false, liabilities: 1_000_000 },
      },
      { migratedAt: "2026-08-30T00:00:00.000Z" }
    );

    expect(normalized?.settings.liabilities).toBeUndefined();
    expect(normalized?.holdings[0].mortgageBalance).toBeUndefined();
    expect(normalized?.loans).toMatchObject([
      {
        id: "legacy-investment-liabilities",
        openingBalance: 1_000_000,
        purpose: "investment",
        dataQuality: "incomplete",
      },
      {
        id: "legacy-mortgage-property-1",
        openingBalance: 6_000_000,
        purpose: "property",
        linkedHoldingId: "property-1",
      },
    ]);

    const normalizedAgain = normalizePortfolioStorage(normalized, {
      migratedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(normalizedAgain?.loans).toHaveLength(2);
  });

  it("keeps valid collateral and balance-history fields", () => {
    const normalized = normalizePortfolioStorage({
      version: 2,
      holdings: [],
      loans: [
        {
          id: "pledge-1",
          name: "股票質押",
          loanType: "securities_pledge",
          purpose: "investment",
          investmentUsePercent: 100,
          openingBalance: 500_000,
          trackingStartDate: "2026-08-01",
          annualInterestRate: 3,
          rateType: "floating",
          repaymentMethod: "revolving",
          creditLimit: 800_000,
          maturityDate: "2027-08-01",
          maintenanceWarningPercent: 160,
          maintenanceCallPercent: 140,
          collateralPositions: [
            { holdingId: "holding-1", quantity: 1_000 },
            { holdingId: "bad", quantity: -1 },
          ],
          balanceHistory: [
            {
              effectiveDate: "2026-08-15",
              balance: 450_000,
              recordedAt: "2026-08-15T00:00:00.000Z",
            },
            { effectiveDate: "2026-07-01", balance: 600_000 },
          ],
          paymentHistory: [
            {
              id: "payment-1",
              paymentDate: "2026-08-20",
              principalPaid: 50_000,
              interestPaid: 1_200,
              feePaid: 10,
              subsidyReceived: 0,
              interestPeriodStartDate: "2026-08-01",
              interestPeriodEndDate: "2026-08-20",
              createdAt: "2026-08-20T00:00:00.000Z",
            },
          ],
          rateHistory: [
            {
              id: "rate-1",
              effectiveDate: "2026-08-10",
              annualInterestRate: 2.8,
              createdAt: "2026-08-10T00:00:00.000Z",
            },
          ],
          status: "active",
          dataQuality: "estimated",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      loanRevisions: [],
      priceHistory: {},
      sales: [],
      corporateActions: [],
      transactions: [],
      transactionRevisions: [],
      pnlTracking: { startedAt: "", dailySummaries: {} },
      settings: { autoUpdateEnabled: false },
    });

    expect(normalized?.loans[0]).toMatchObject({
      creditLimit: 800_000,
      maturityDate: "2027-08-01",
      collateralPositions: [{ holdingId: "holding-1", quantity: 1_000 }],
      balanceHistory: [
        { effectiveDate: "2026-07-01", balance: 600_000 },
        { effectiveDate: "2026-08-15", balance: 450_000 },
      ],
      paymentHistory: [{ id: "payment-1", interestPaid: 1_200 }],
      rateHistory: [{ id: "rate-1", annualInterestRate: 2.8 }],
    });
  });
});
