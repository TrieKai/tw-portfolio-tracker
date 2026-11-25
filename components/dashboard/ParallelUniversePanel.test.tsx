import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParallelUniversePanel } from "@/components/dashboard/ParallelUniversePanel";
import { enrichHoldings } from "@/lib/portfolio/calculations";
import type { Holding } from "@/lib/types/holding";
import { AmountPrivacyProvider } from "@/providers/AmountPrivacyProvider";

const first: Holding = {
  id: "first", assetType: "stock", name: "測試股票", symbol: "2330", market: "tse",
  quantity: 10, buyDate: "2026-10-10", buyPrice: 50, currentPrice: 120, priceDate: "2026-11-10",
  createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z",
};
const holdings = enrichHoldings([
  first,
  { ...first, id: "second", buyDate: "2026-11-12", quantity: 5, buyPrice: 80, currentPrice: undefined, priceDate: undefined },
]);

function render(prices: [number, number, number]) {
  return renderToStaticMarkup(
    <AmountPrivacyProvider>
      <ParallelUniversePanel
        holdings={holdings}
        priceHistory={{
          first: [
            { date: "2026-10-29", price: prices[0], source: "api" },
            { date: "2026-11-06", price: prices[1], source: "api" },
            { date: "2026-11-13", price: prices[2], source: "api" },
          ],
        }}
        corporateActions={[]}
        asOfDate="2026-11-20"
      />
    </AmountPrivacyProvider>
  );
}

describe("strategy comparison and recorded holdings", () => {
  it("uses each recorded lot valuation and awards the lead only to the better simulation", () => {
    const html = render([180, 160, 100]);
    const actual = html.match(/回看日持有.*?<\/section>/)?.[0] ?? "";
    expect(actual).toContain("$1,600");
    expect(actual).toContain("$900");
    expect(actual).toContain("依總覽估值 2026-11-20");
    expect(actual).not.toContain("本次領先");
    expect(html.match(/<p[^>]*>每月定期定額<\/p>.*?<\/section>/)?.[0]).toContain("本次領先");
    expect(html).toContain("回測 2026-10-29～2026-11-13");
  });

  it("shows no leader when both simulations display the same return", () => {
    const html = render([100, 100, 100]);
    expect(html).toContain("期初一次投入");
    expect(html).not.toContain("本次領先");
  });
});
