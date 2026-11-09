import { DIMENSIONS, type Evaluation } from "./evaluation-schema";

export type DimensionId = keyof typeof DIMENSIONS;
export type ScoreWeights = Readonly<Record<DimensionId, number>>;

// Product weights confirmed by the user; these are not calibrated hiring probabilities.
export const SCORE_WEIGHTS: ScoreWeights = {
  relevance: 25, contribution: 15, methods: 15,
  outcomes: 15, clarity: 10, faithfulness: 20,
};

const round = (value: number) => Number(value.toFixed(1));
const validScore = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;

export function compareScores(dimensions: Evaluation["dimensions"], weights: ScoreWeights = SCORE_WEIGHTS) {
  const ids = Object.keys(DIMENSIONS) as DimensionId[];
  if (ids.some((id) => !Number.isFinite(weights[id]) || weights[id] < 0) ||
      ids.reduce((sum, id) => sum + weights[id], 0) <= 0) {
    throw new Error("评分权重必须是非负数，且至少一项大于零。");
  }
  const allWeight = ids.reduce((sum, id) => sum + weights[id], 0);
  const rows = ids.map((id) => {
    const dimension = dimensions.find((d) => d.id === id);
    const before = validScore(dimension?.before.score);
    const after = validScore(dimension?.after.score);
    return {
      id, label: DIMENSIONS[id], before, after,
      delta: before !== null && after !== null ? after - before : null,
      weight: weights[id], weightPercent: round(weights[id] / allWeight * 100),
    };
  });
  // Both totals MUST use the same dimensions and denominator. Null is not zero.
  const included = rows.filter((r) => r.before !== null && r.after !== null && r.weight > 0);
  const includedWeight = included.reduce((sum, r) => sum + r.weight, 0);
  const total = (version: "before" | "after") => includedWeight === 0 ? null :
    round(included.reduce((sum, r) => sum + r[version]! * r.weight, 0) / includedWeight / 3 * 100);
  const before = total("before"), after = total("after");
  return {
    rows, before, after,
    delta: before !== null && after !== null ? round(after - before) : null,
    includedCount: included.length,
    excludedLabels: rows.filter((r) => !included.includes(r)).map((r) => r.label),
  };
}
