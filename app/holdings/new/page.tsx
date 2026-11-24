import { AddHoldingForm } from "@/components/holdings/AddHoldingForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewHoldingPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="新增持倉"
        description="記錄台股、境內基金或房產。股票與基金儲存後會嘗試更新現價。"
      />
      <AddHoldingForm />
    </div>
  );
}
