import { describe, expect, it } from "vitest";
import {
  calculateLoanCollateralValuation,
  calculatePortfolioLoanRisk,
  calculatePortfolioLoanRiskSummary,
} from "@/lib/loans/risk";
import type { Holding } from "@/lib/types/holding";
import type { Loan } from "@/lib/types/loan";
import { buildLoanReminders } from "@/lib/loans/reminders";
import { buildPortfolioHistory } from "@/lib/portfolio/time-travel";
import { addLoan, editLoan } from "@/lib/storage/loan-store";
import { defaultPortfolioStorage, normalizePortfolioStorage } from "@/lib/storage/parse-portfolio";
import { mergePortfolioStorage } from "@/lib/storage/portfolio-export";
import { addHolding, applyCorporateAction, applyManualCorporateAction, applyPriceUpdate } from "@/lib/storage/portfolio-store";

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "holding-1",
    assetType: "stock",
    name: "測試股票",
    symbol: "2330",
    market: "tse",
    buyPrice: 800,
    quantity: 1_000,
    buyDate: "2025-01-01",
    currentPrice: 900,
    priceDate: "2026-08-30",
    priceSource: "api",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    name: "測試質押",
    loanType: "securities_pledge",
    purpose: "investment",
    investmentUsePercent: 100,
    openingBalance: 500_000,
    trackingStartDate: "2026-08-01",
    annualInterestRate: 3,
    rateType: "floating",
    repaymentMethod: "interest_only",
    maintenanceWarningPercent: 160,
    maintenanceCallPercent: 140,
    collateralPositions: [{ holdingId: "holding-1", quantity: 1_000 }],
    status: "active",
    dataQuality: "estimated",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loan collateral risk", () => {
  it("flags overlapping collateral instead of counting the same holding on both loans", () => {
    const terms = { openingBalance: 300_000, collateralPositions: [{ holdingId: "holding-1", quantity: 800 }] };
    const first = loan(terms);
    const second = loan({ ...terms, id: "loan-2", name: "第二筆貸款", openingBalance: 600_000 });
    const date = "2026-08-30";
    const holdings = [holding()];
    const summary = calculatePortfolioLoanRiskSummary([first, second], holdings, date);
    expect(summary).toMatchObject({
      unknownCount: 2, criticalCount: 0, warningCount: 0, lowestMaintenanceRatioPercent: null,
      totalCollateralMarketValue: 900_000,
      collateralOverlaps: [{ holdingId: "holding-1", requestedQuantity: 1_600, availableQuantity: 1_000 }],
    });
    expect(buildLoanReminders([first, second], holdings, date).map((reminder) => reminder.kind))
      .toEqual(["collateral_overlap", "collateral_overlap"]);
    const valuation = calculatePortfolioLoanRisk([first, second], holdings, date).valuations.get(first.id);
    expect(valuation).toMatchObject({ maintenanceRatioPercent: null, overlappingPositionCount: 1, riskLevel: "unknown" });
  });

  it("checks the combined quantities after merging loans recorded in different share units", () => {
    const opened = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", symbol: "2330", name: "共用擔保驗證", buyDate: "2026-11-02", buyPrice: 200, quantity: 100,
    });
    const holdingId = opened.holdings[0].id;
    const base = applyPriceUpdate(opened, holdingId, 200, "2026-11-06", "manual");
    const first = addLoan(base, loan({ trackingStartDate: "2026-11-06", openingBalance: 3_000,
      collateralPositions: [{ holdingId, quantity: 60 }] }), "2026-11-06T08:00:00Z");
    const split = applyManualCorporateAction(base, { holdingId, actionType: "split", adjustmentRatio: 2, effectiveDate: "2026-11-10" });
    const backup = addLoan(split, loan({ name: "另一裝置", trackingStartDate: "2026-11-11", openingBalance: 3_000,
      collateralPositions: [{ holdingId, quantity: 100 }] }), "2026-11-11T08:00:00Z");
    const merged = mergePortfolioStorage(first, backup);
    const date = "2026-11-14";
    expect(calculatePortfolioLoanRiskSummary(merged.loans, merged.holdings, date, merged.corporateActions)).toMatchObject({
      collateralOverlaps: [{ holdingId, requestedQuantity: 220, availableQuantity: 200 }],
      unknownCount: 2, totalCollateralMarketValue: 20_000,
    });
    const [firstLoan, secondLoan] = merged.loans;
    const corrected = editLoan(merged, { ...secondLoan, collateralPositions: [{ holdingId, quantity: 80 }] }, "2026-11-15T08:00:00Z");
    const result = calculatePortfolioLoanRisk(corrected.loans, corrected.holdings, "2026-11-15", corrected.corporateActions);
    expect(result.summary).toMatchObject({ collateralOverlaps: [], unknownCount: 0, totalCollateralMarketValue: 20_000 });
    expect(result.valuations.get(firstLoan.id)?.trackedCollateralValue).toBe(12_000);
    expect(result.valuations.get(secondLoan.id)?.trackedCollateralValue).toBe(8_000);
  });

  it("allows separate shares of one holding and excludes loans outside the selected date", () => {
    const first = loan({ openingBalance: 200_000, collateralPositions: [{ holdingId: "holding-1", quantity: 600 }] });
    const second = loan({ id: "loan-2", openingBalance: 200_000, collateralPositions: [{ holdingId: "holding-1", quantity: 400 }] });
    const future = loan({ id: "future", trackingStartDate: "2026-09-01" });
    const closed = loan({ id: "closed", status: "paid_off", closedAt: "2026-08-29" });
    expect(calculatePortfolioLoanRiskSummary([first, second, future, closed], [holding()], "2026-08-30"))
      .toMatchObject({ monitoredLoanCount: 2, unknownCount: 0, lowestMaintenanceRatioPercent: 180,
        totalCollateralMarketValue: 900_000, collateralOverlaps: [], });
  });

  it("enforces the available shares once when a backup repeats one holding within a single loan", () => {
    const pledge = loan({ collateralPositions: [
      { holdingId: "holding-1", quantity: 600 }, { holdingId: "holding-1", quantity: 600 },
    ] });
    expect(calculateLoanCollateralValuation(pledge, [holding()], "2026-08-30"))
      .toMatchObject({ trackedCollateralValue: 900_000, missingPositionCount: 1 });
  });

  it("keeps a partial quote valuation but defers collateral alerts while another position is unpriced", () => {
    const pledge = loan({ openingBalance: 500_000, collateralPositions: [
      { holdingId: "holding-1", quantity: 600 }, { holdingId: "holding-2", quantity: 600 },
    ] });
    const holdings = [holding(), holding({ id: "holding-2", symbol: "2317", currentPrice: undefined })];
    const date = "2026-08-30";
    expect(calculateLoanCollateralValuation(pledge, holdings, date)).toMatchObject({
      collateralMarketValue: 540_000, missingPositionCount: 1, maintenanceRatioPercent: null, riskLevel: "unknown",
    });
    expect(buildLoanReminders([pledge], holdings, date).map((reminder) => reminder.kind)).toEqual(["risk_data_missing"]);
    const priced = [holdings[0], { ...holdings[1], currentPrice: 900 }];
    expect(calculateLoanCollateralValuation(pledge, priced, date)).toMatchObject({ maintenanceRatioPercent: 216, riskLevel: "safe" });
  });

  it("keeps split collateral value consistent on both sides of the effective date and in reminders", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試質押股票", symbol: "2330", buyDate: "2026-11-02", buyPrice: 200, quantity: 100,
    });
    const holdingId = state.holdings[0].id;
    state = applyPriceUpdate(state, holdingId, 200, "2026-11-06", "manual");
    state = addLoan(state, loan({ openingBalance: 10_000, trackingStartDate: "2026-11-06",
      collateralPositions: [{ holdingId, quantity: 100 }] }), "2026-11-06T08:00:00.000Z");
    state = applyManualCorporateAction(state, { holdingId, effectiveDate: "2026-11-10", adjustmentRatio: 2, actionType: "split" });

    const [pledge] = state.loans;
    const history = buildPortfolioHistory(state);
    expect(pledge.collateralPositions?.[0].quantity).toBe(100);
    expect(state.holdings[0]).toMatchObject({ quantity: 200, currentPrice: 100 });
    for (const date of ["2026-11-06", "2026-11-10", "2026-11-14"]) {
      const holdings = history.snapshotOn(date);
      const risk = calculateLoanCollateralValuation(pledge, holdings, date, state.corporateActions);
      expect(risk).toMatchObject({ collateralMarketValue: 20_000, maintenanceRatioPercent: 200, missingPositionCount: 0, riskLevel: "safe" });
      expect(calculatePortfolioLoanRiskSummary(state.loans, holdings, date, state.corporateActions)).toMatchObject({ criticalCount: 0, lowestMaintenanceRatioPercent: 200 });
      expect(buildLoanReminders(state.loans, holdings, date, state.corporateActions)).toEqual([]);
    }
  });

  it("uses the quantity basis captured in each backup and does not apply the same split twice", () => {
    const initial = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試質押股票", symbol: "2330", buyDate: "2026-11-02", buyPrice: 200, quantity: 100,
    });
    const holdingId = initial.holdings[0].id;
    const quoted = applyPriceUpdate(initial, holdingId, 200, "2026-11-06", "manual");
    const split = applyManualCorporateAction(quoted, { holdingId, effectiveDate: "2026-11-08", adjustmentRatio: 2, actionType: "split" });
    const terms = loan({ openingBalance: 10_000, trackingStartDate: "2026-11-09", collateralPositions: [{ holdingId, quantity: 100 }] });
    const unadjusted = addLoan(quoted, terms, "2026-11-15T08:00:00.000Z");
    const combined = mergePortfolioStorage(unadjusted, split);
    expect(calculateLoanCollateralValuation(combined.loans[0], combined.holdings, "2026-11-15", combined.corporateActions)).toMatchObject({
      collateralMarketValue: 20_000, maintenanceRatioPercent: 200,
    });
    const edited = editLoan(combined, { ...combined.loans[0], collateralPositions: [{ holdingId, quantity: 160 }] }, "2026-11-16T08:00:00.000Z");
    const restored = normalizePortfolioStorage(mergePortfolioStorage(edited, combined))!;
    expect(calculateLoanCollateralValuation(restored.loans[0], restored.holdings, "2026-11-15", restored.corporateActions)).toMatchObject({
      collateralMarketValue: 16_000, maintenanceRatioPercent: 160, missingPositionCount: 0,
    });
  });

  it("recovers the recording basis from legacy revisions when a different loan field was edited", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試質押股票", symbol: "2330", buyDate: "2026-11-02", buyPrice: 200, quantity: 100,
    });
    const holdingId = state.holdings[0].id;
    state = applyPriceUpdate(state, holdingId, 200, "2026-11-06", "manual");
    state = applyManualCorporateAction(state, { holdingId, effectiveDate: "2026-11-10", adjustmentRatio: 2, actionType: "split" });
    state = { ...state, corporateActions: state.corporateActions.map((action) => ({
      ...action, createdAt: "2026-11-11T08:00:00.000Z",
    })) };
    const recordedBefore = "2026-11-06T08:00:00.000Z";
    const recordedAfter = "2026-11-14T08:00:00.000Z";
    const before = loan({ id: "legacy-before", openingBalance: 10_000, trackingStartDate: "2026-11-06",
      collateralPositions: [{ holdingId, quantity: 100 }], createdAt: recordedBefore, updatedAt: recordedBefore, contractUpdatedAt: recordedBefore });
    const renamed = { ...before, name: "改名後的貸款", updatedAt: recordedAfter, contractUpdatedAt: recordedAfter };
    const after = loan({ ...renamed, id: "legacy-after", createdAt: recordedAfter, collateralPositions: [{ holdingId, quantity: 200 }] });
    const restored = normalizePortfolioStorage({
      ...state, loans: [renamed, after], loanRevisions: [{ id: "revision-before", loanId: before.id, correctedAt: recordedAfter, previous: before }],
    })!;
    expect(restored.loans.map((item) => item.collateralPositions?.[0].shareBasisFactor)).toEqual([1, 2]);
    for (const item of restored.loans) {
      expect(calculateLoanCollateralValuation(item, restored.holdings, "2026-11-15", restored.corporateActions)).toMatchObject({
        collateralMarketValue: 20_000, maintenanceRatioPercent: 200,
      });
    }
    expect(normalizePortfolioStorage(restored)).toEqual(restored);
  });

  it("applies reverse split conversions without adding subsequent stock dividends to the pledge", () => {
    let state = addHolding(defaultPortfolioStorage(), {
      assetType: "stock", name: "測試質押股票", symbol: "2330", buyDate: "2026-11-02", buyPrice: 100, quantity: 100,
    });
    const holdingId = state.holdings[0].id;
    state = addLoan(state, loan({ openingBalance: 2_000, trackingStartDate: "2026-11-06",
      collateralPositions: [{ holdingId, quantity: 40 }] }), "2026-11-06T08:00:00.000Z");
    state = applyManualCorporateAction(state, { holdingId, effectiveDate: "2026-11-10", adjustmentRatio: 0.5, actionType: "reverse_split" });
    state = applyCorporateAction(state, {
      id: "fixture-unpledged-dividend", holdingId, symbol: "2330", market: "tse", name: "測試質押股票",
      effectiveDate: "2026-11-12", type: "stock_dividend", source: "twse", stockDividendRatio: 0.2,
      subscriptionRatio: 0, exDividendLabel: "除權", autoApplicable: true,
    });
    state = applyPriceUpdate(state, holdingId, 200, "2026-11-13", "manual");
    expect(state.holdings[0].quantity).toBe(60);
    expect(calculateLoanCollateralValuation(state.loans[0], state.holdings, "2026-11-15", state.corporateActions)).toMatchObject({
      collateralMarketValue: 4_000, maintenanceRatioPercent: 200, missingPositionCount: 0,
    });
  });

  it("recognizes fractional collateral at the tracked balance while detecting real shortages", () => {
    const pledged = loan({ openingBalance: 1, collateralPositions: [{ holdingId: "holding-1", quantity: 0.2 }] });
    const priced = holding({ assetType: "fund", quantity: 0.3 - 0.1, currentPrice: 10 });
    const valuation = calculateLoanCollateralValuation(pledged, [priced], "2026-08-30");
    expect(valuation.collateralMarketValue).toBeCloseTo(2);
    expect(valuation.missingPositionCount).toBe(0);
    expect(valuation.riskLevel).toBe("safe");
    const shortage = calculateLoanCollateralValuation(pledged, [{ ...priced, quantity: 0.19 }], "2026-08-30");
    expect(shortage.missingPositionCount).toBe(1);
  });

  it("computes maintenance ratio and price-drop buffers", () => {
    const valuation = calculateLoanCollateralValuation(
      loan(),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(900_000);
    expect(valuation.maintenanceRatioPercent).toBe(180);
    expect(valuation.warningBufferPercent).toBeCloseTo(11.1111, 3);
    expect(valuation.callBufferPercent).toBeCloseTo(22.2222, 3);
    expect(valuation.riskLevel).toBe("safe");
  });

  it("marks warning and critical levels using contract thresholds", () => {
    expect(
      calculateLoanCollateralValuation(loan(), [holding({ currentPrice: 780 })], "2026-08-30").riskLevel
    ).toBe("warning");
    expect(
      calculateLoanCollateralValuation(loan(), [holding({ currentPrice: 680 })], "2026-08-30").riskLevel
    ).toBe("critical");
  });

  it("does not use cost basis when current collateral price is missing", () => {
    const valuation = calculateLoanCollateralValuation(
      loan(),
      [holding({ currentPrice: undefined })],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(0);
    expect(valuation.missingPositionCount).toBe(1);
    expect(valuation.riskLevel).toBe("unknown");
  });

  it("does not value more collateral units than the tracked holding", () => {
    const valuation = calculateLoanCollateralValuation(
      loan({
        collateralPositions: [{ holdingId: "holding-1", quantity: 2_000 }],
      }),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.collateralMarketValue).toBe(900_000);
    expect(valuation.missingPositionCount).toBe(1);
    expect(valuation.riskLevel).toBe("unknown");
  });

  it("tracks credit utilization and overdue maturity", () => {
    const valuation = calculateLoanCollateralValuation(
      loan({ creditLimit: 800_000, maturityDate: "2026-08-29" }),
      [holding()],
      "2026-08-30"
    );

    expect(valuation.creditUtilizationPercent).toBe(62.5);
    expect(valuation.availableCredit).toBe(300_000);
    expect(valuation.riskLevel).toBe("critical");
  });

  it("summarizes monitored flexible-credit loans", () => {
    const summary = calculatePortfolioLoanRiskSummary(
      [
        loan(),
        loan({ id: "unknown", collateralPositions: [] }),
        loan({
          id: "revolving",
          loanType: "revolving_credit",
          collateralPositions: undefined,
          maintenanceWarningPercent: undefined,
          maintenanceCallPercent: undefined,
        }),
      ],
      [holding()],
      "2026-08-30"
    );

    expect(summary.monitoredLoanCount).toBe(3);
    expect(summary.unknownCount).toBe(1);
    expect(summary.lowestMaintenanceRatioPercent).toBe(180);
  });
});
