"use client";

import Link from "next/link";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function HoldingsPage() {
  const { ready, holdings } = usePortfolio();

  if (!ready) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">持倉列表</h1>
        <Link href="/holdings/new" className="btn-primary">
          新增持倉
        </Link>
      </div>
      <HoldingsTable holdings={holdings} />
    </div>
  );
}
