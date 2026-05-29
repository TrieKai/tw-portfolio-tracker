"use client";

import Link from "next/link";
import { HoldingsTable } from "@/components/holdings/HoldingsTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { usePortfolio } from "@/providers/PortfolioProvider";

export default function HoldingsPage() {
  const { ready, holdings } = usePortfolio();

  if (!ready) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="持倉列表"
        action={
          <Link href="/holdings/new" className="btn-primary w-full sm:w-auto touch-target">
            新增持倉
          </Link>
        }
      />
      <HoldingsTable holdings={holdings} />
    </div>
  );
}
