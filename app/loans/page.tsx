import type { Metadata } from "next";
import { LoanManager } from "@/components/loans/LoanManager";

export const metadata: Metadata = { title: "貸款管理" };

export default function LoansPage() {
  return <LoanManager />;
}
