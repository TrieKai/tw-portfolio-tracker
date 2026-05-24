import { AddHoldingForm } from "@/components/holdings/AddHoldingForm";

export default function NewHoldingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">新增持倉</h1>
        <p className="mt-1 text-sm text-muted">
          支援台股（上市/上櫃）與境內基金；儲存後將自動嘗試更新現價
        </p>
      </div>
      <AddHoldingForm />
    </div>
  );
}
