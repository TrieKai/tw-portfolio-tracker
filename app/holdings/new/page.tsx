import { AddHoldingForm } from "@/components/holdings/AddHoldingForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewHoldingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="新增持倉"
        description="支援台股（上市/上櫃）、境內基金與房子；股票/基金儲存後將自動嘗試更新現價"
      />
      <AddHoldingForm />
    </div>
  );
}
