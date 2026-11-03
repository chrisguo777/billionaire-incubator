export interface ReviewChoice {
  text: string;
  status: "accepted" | "excluded" | "pending";
}
export type ReviewChoices = Record<string, ReviewChoice>;
export const bulletKey = (cardId: string, index: number, originalId?: string | null, sourceIds?: readonly string[]) =>
  `${cardId}:${originalId ?? (sourceIds?.length ? `new:${[...new Set(sourceIds)].sort().join(",")}` : index)}`;
