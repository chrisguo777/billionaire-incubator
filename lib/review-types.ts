export interface ReviewChoice {
  text: string;
  status: "accepted" | "excluded" | "pending";
}
export type ReviewChoices = Record<string, ReviewChoice>;
export const bulletKey = (cardId: string, index: number) => `${cardId}:${index}`;
