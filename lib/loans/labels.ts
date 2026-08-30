import type {
  LoanDataQuality,
  LoanPurpose,
  LoanRepaymentMethod,
  LoanType,
} from "@/lib/types/loan";

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  personal_credit: "信用貸款",
  securities_margin: "證券融資",
  securities_pledge: "證券質押",
  mortgage: "房貸",
  home_equity: "房屋增貸／理財型房貸",
  policy: "保單借款",
  revolving_credit: "循環額度",
  private: "親友／私人借款",
  other: "其他貸款",
};

export const LOAN_PURPOSE_LABELS: Record<LoanPurpose, string> = {
  investment: "投資用途",
  property: "房產用途",
  personal: "個人用途",
  mixed: "混合用途",
};

export const REPAYMENT_METHOD_LABELS: Record<LoanRepaymentMethod, string> = {
  equal_payment: "本息平均攤還",
  equal_principal: "本金平均攤還",
  interest_only: "只繳息、到期還本",
  bullet: "到期一次清償",
  revolving: "隨借隨還",
};

export const LOAN_QUALITY_LABELS: Record<LoanDataQuality, string> = {
  complete: "完整資料",
  estimated: "估算",
  incomplete: "待補資料",
};
