import {
  endOfMonthIsoFromPrefix,
  formatYearMonthZh,
  listMonthPrefixesDescending,
  monthPrefixFromIsoDate,
} from "@/lib/date/iso-date";
import { loansWithConsistentPhases } from "@/lib/loans/phases";
import { loanEstimateEndDate, loanPaymentsInTracking } from "@/lib/loans/history";
import { investmentUsePercentForPurpose } from "@/lib/loans/purpose";
import { buildPnlCalendar } from "@/lib/portfolio/pnl-calendar";
import type { PortfolioStorage } from "@/lib/types/holding";

export interface MonthlyPerformanceRow {
  monthPrefix: string;
  monthLabel: string;
  investmentPnl: number;
  financingCost: number;
  netPnl: number;
  returnRate: number | null;
  returnRateIncomplete: boolean;
  dataDayCount: number;
  completeDayCount: number;
}

function monthsWithRecords(storage: PortfolioStorage, asOfDate: string) {
  const months = new Set<string>();
  function addDate(date: string) {
    if (date <= asOfDate) months.add(monthPrefixFromIsoDate(date));
  }
  for (const summary of Object.values(storage.pnlTracking.dailySummaries)) addDate(summary.date);
  for (const points of Object.values(storage.priceHistory)) {
    for (const { date } of points) addDate(date);
  }
  for (const event of storage.transactions) {
    if (event.type === "buy" || event.type === "sell" || event.type === "cash_dividend") addDate(event.date);
  }
  for (const sale of storage.sales) {
    if (sale.assetType !== "property") addDate(sale.sellDate);
  }
  // 貸款可能在沒有行情及交易的月份繼續計息。
  for (const loan of loansWithConsistentPhases(storage.loans)) {
    if (investmentUsePercentForPurpose(loan.purpose, loan.investmentUsePercent) <= 0 || loan.trackingStartDate > asOfDate) continue;
    for (const payment of loanPaymentsInTracking(loan)) addDate(payment.paymentDate);
    const lastDate = loanEstimateEndDate(loan, asOfDate);
    for (const month of listMonthPrefixesDescending(monthPrefixFromIsoDate(loan.trackingStartDate), monthPrefixFromIsoDate(lastDate))) {
      months.add(month);
    }
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

export function buildMonthlyPerformance(
  storage: PortfolioStorage,
  asOfDate: string,
  includeEarlierYears = false
) {
  const rows: MonthlyPerformanceRow[] = [];
  const yearStart = `${asOfDate.slice(0, 4)}-01`;
  let hasEarlierMonths = false;
  for (const monthPrefix of monthsWithRecords(storage, asOfDate)) {
    const isEarlierYear = monthPrefix < yearStart;
    const monthEnd = endOfMonthIsoFromPrefix(monthPrefix);
    const { summary, grossSummary } = buildPnlCalendar(storage, {
      month: monthPrefix,
      asOfDate: monthEnd < asOfDate ? monthEnd : asOfDate,
      filter: { kind: "investment" },
      includeFinancingCosts: true,
    });
    if (summary.dataDayCount === 0) continue;
    if (isEarlierYear) {
      hasEarlierMonths = true;
      if (!includeEarlierYears) break;
    }
    const gross = grossSummary ?? summary;
    rows.push({
      monthPrefix,
      monthLabel: formatYearMonthZh(monthPrefix),
      investmentPnl: gross.pnl,
      financingCost: summary.financingCost ?? 0,
      netPnl: summary.pnl,
      returnRate: gross.dataDayCount ? gross.returnRate : null,
      returnRateIncomplete: !!gross.returnRateIncomplete,
      dataDayCount: gross.dataDayCount,
      completeDayCount: gross.completeDayCount,
    });
  }
  return { rows, hasEarlierMonths };
}
