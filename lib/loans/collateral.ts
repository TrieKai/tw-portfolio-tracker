import { corporateActionAdjustmentRatio, holdingActions } from "@/lib/corporate-actions/adjustment";
import type { CorporateActionRecord, Holding, PortfolioStorage } from "@/lib/types/holding";
import type { Loan, LoanCollateralPosition, LoanRevision } from "@/lib/types/loan";

function replacementActions(holding: Holding, actions: CorporateActionRecord[]) {
  // 股利是否續作擔保取決於實際認列。此處只換算原擔保證券換發後的股數。
  return holdingActions(actions, holding).filter((action) => action.effectiveDate > holding.buyDate &&
    (action.actionType === "split" || action.actionType === "reverse_split" ||
      action.actionType === "capital_reduction" || action.actionType === "share_exchange"));
}

export function collateralShareFactor(holding: Holding, actions: CorporateActionRecord[], date: string): number {
  return replacementActions(holding, actions).reduce((factor, action) =>
    action.effectiveDate <= date ? factor * corporateActionAdjustmentRatio(action) : factor, 1);
}

function collateralFactorAtEntry(holding: Holding, actions: CorporateActionRecord[], recordedAt: string): number {
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp)) return 1;
  return replacementActions(holding, actions).reduce((factor, action) =>
    Date.parse(action.createdAt) <= timestamp
      ? factor * corporateActionAdjustmentRatio(action) : factor, 1);
}

export function collateralQuantityOn(
  position: LoanCollateralPosition,
  holding: Holding,
  actions: CorporateActionRecord[],
  date: string,
  recordedAt: string
): number {
  if (holding.assetType !== "stock") return position.quantity;
  const basis = position.shareBasisFactor ?? collateralFactorAtEntry(holding, actions, recordedAt);
  return position.quantity * (collateralShareFactor(holding, actions, date) / basis);
}

function legacyCollateralBasis(
  loan: Loan,
  position: LoanCollateralPosition,
  holding: Holding,
  actions: CorporateActionRecord[],
  revisions: LoanRevision[]
): number {
  let recordedAt = loan.contractUpdatedAt ?? loan.createdAt;
  const contractTime = Date.parse(loan.contractUpdatedAt ?? loan.updatedAt);
  const previousVersions = revisions.filter((revision) => Date.parse(revision.correctedAt) <= contractTime)
    .sort((a, b) => Date.parse(b.correctedAt) - Date.parse(a.correctedAt));
  for (const { previous } of previousVersions) {
    const old = previous.collateralPositions?.find((item) => item.holdingId === position.holdingId);
    if (!old || old.quantity !== position.quantity) break;
    if (old.shareBasisFactor !== undefined) return old.shareBasisFactor;
    recordedAt = previous.contractUpdatedAt ?? previous.createdAt;
  }
  return collateralFactorAtEntry(holding, actions, recordedAt);
}

/** 以該份備份已知的公司行動還原輸入股數的基準，合併時保留各來源的基準。 */
export function restoreCollateralShareBases(state: PortfolioStorage): PortfolioStorage {
  if (!state.loans.some((loan) => loan.collateralPositions?.some((position) => position.shareBasisFactor === undefined))) return state;
  const stockById = new Map([...state.holdings, ...(state.holdingRemovals ?? []).map(({ holding }) => holding)]
    .filter((holding) => holding.assetType === "stock").map((holding) => [holding.id, holding]));
  const revisionsById = new Map<string, LoanRevision[]>();
  for (const revision of state.loanRevisions) {
    const history = revisionsById.get(revision.loanId) ?? [];
    history.push(revision);
    revisionsById.set(revision.loanId, history);
  }
  let changed = false;
  const loans = state.loans.map((loan) => {
    let restored = false;
    const collateralPositions = loan.collateralPositions?.map((position) => {
      const holding = stockById.get(position.holdingId);
      if (!holding || position.shareBasisFactor !== undefined) return position;
      const factor = legacyCollateralBasis(loan, position, holding, state.corporateActions, revisionsById.get(loan.id) ?? []);
      if (!Number.isFinite(factor) || factor <= 0) return position;
      restored = true;
      return { ...position, shareBasisFactor: factor };
    });
    if (!restored) return loan;
    changed = true;
    return { ...loan, collateralPositions };
  });
  return changed ? { ...state, loans } : state;
}
