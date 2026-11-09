export interface ReviewChoice {
  text: string;
  status: "accepted" | "excluded" | "pending";
}
export type ReviewChoices = Record<string, ReviewChoice>;

// Ignore wrapping/extra whitespace, but keep case, punctuation and wording changes.
export function needsBulletReview(originalText: string | undefined, proposedText: string): boolean {
  if (originalText === undefined) return proposedText.trim().length > 0;
  const comparable = (text: string) => text.normalize("NFC").replace(/\s+/gu, " ").trim();
  return comparable(originalText) !== comparable(proposedText);
}

export const bulletKey = (cardId: string, index: number, originalId?: string | null, sourceIds?: readonly string[]) =>
  `${cardId}:${originalId ?? (sourceIds?.length ? `new:${[...new Set(sourceIds)].sort().join(",")}` : index)}`;
