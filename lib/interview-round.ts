import type { Asked, Gap, JDAnalysis } from "./schema";
import { isEducationRequirement } from "./education-match";

export interface InterviewHistoryItem { kind?: string; requirement?: { id: string }; question: string; answer: string }
export const isRegularInterviewTurn = (t: InterviewHistoryItem) => t.kind !== "experience";

// A new round prefers unused requirements, then the least asked remaining topic.
// Explicit 'none' answers and education requirements never become retry targets.
export function pickRetryGap(gaps: Gap[], jd: JDAnalysis, asked: Asked, history: InterviewHistoryItem[], roundStart: number): Gap | null {
  const used = new Set(history.slice(roundStart).filter(isRegularInterviewTurn).map(t => t.requirement?.id));
  const counts = new Map<string, number>();
  history.filter(isRegularInterviewTurn).forEach(t => { if (t.requirement) counts.set(t.requirement.id, (counts.get(t.requirement.id) ?? 0) + 1); });
  const priority = { high: 0, medium: 1, low: 2 };
  const candidates = gaps.filter(g => {
    const r = jd.requirements.find(r => r.id === g.requirement_id);
    return r && !isEducationRequirement(r) && !used.has(r.id) && asked[r.id] !== "none" && g.status !== "true_gap";
  }).sort((a, b) => {
    const ra = jd.requirements.find(r => r.id === a.requirement_id)!;
    const rb = jd.requirements.find(r => r.id === b.requirement_id)!;
    return (counts.get(ra.id) ?? 0) - (counts.get(rb.id) ?? 0) || priority[ra.priority] - priority[rb.priority];
  });
  return candidates[0] ?? null;
}
