import { AddHoldingForm } from "@/components/holdings/AddHoldingForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewHoldingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="新增持倉"
        description="支援台股（上市/上櫃）與境內基金；儲存後將自動嘗試更新現價"
      />
      <AddHoldingForm />
    </div>
  );
}
