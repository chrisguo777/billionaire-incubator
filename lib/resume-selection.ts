export type CardEvidenceStatus = "supported" | "insufficient" | "unmatched";
export const CARD_EVIDENCE_LABELS: Record<CardEvidenceStatus, string> = {
  supported: "已有匹配证据",
  insufficient: "证据不足",
  unmatched: "暂无匹配证据",
};

export class InvalidCardSelectionError extends Error {}

// Matching evidence affects rank and explanations, never the user's selection.
// undefined preserves the default; [] is an explicit choice to remove all cards.
export function selectResumeCards<T extends { card_id: string; included: boolean }>(
  ranked: readonly T[], selectedCardIds?: readonly string[],
): T[] {
  if (selectedCardIds === undefined) return ranked.map((r) => ({ ...r, included: true }));
  const allowed = new Set(ranked.map((r) => r.card_id));
  if (!Array.isArray(selectedCardIds) || selectedCardIds.some((id) => typeof id !== "string" || !allowed.has(id))) {
    throw new InvalidCardSelectionError("经历选择无效，请选择列表中的经历");
  }
  const selected = new Set(selectedCardIds);
  return ranked.map((r) => ({ ...r, included: selected.has(r.card_id) }));
}
