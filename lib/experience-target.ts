import { FACT_FIELDS, type ExperienceDB, type JDAnalysis } from "./schema";
import { uniqueOriginals } from "./original-bullets";
import { selectResumeCards } from "./resume-selection";

// 0 = 暂时关闭「补足经历」追问；原值为 3，重新开启前先确认追问话术和测试（tests/experience-discovery.cjs）。
export const TARGET_EXPERIENCES = 0;
export interface ExperienceDiscoveryState {
  exhausted: boolean;
  followUp?: string | null;
}

export function discoveryState(value?: Partial<ExperienceDiscoveryState> | null): ExperienceDiscoveryState {
  return { exhausted: value?.exhausted === true, followUp: typeof value?.followUp === "string" ? value.followUp : null };
}

// Count substantive experience cards, excluding skills and duplicate CV blocks.
// A title, a tool name, or an unconfirmed result alone is not another experience.
export function countExperiences(db: ExperienceDB, selectedCardIds?: readonly string[]): number {
  const candidates = db.cards.filter((c) => db.affiliations.find((a) => a.id === c.affiliation_id)?.type !== "skills_list");
  const selected = selectResumeCards(candidates.map((c) => ({ card_id: c.id, included: true })), selectedCardIds)
    .filter((c) => c.included).map((c) => c.card_id);
  const originals = uniqueOriginals(db, selected);
  return candidates.filter((c) => selected.includes(c.id) && (
    (originals.get(c.id)?.length ?? 0) > 0 ||
    ((!c.original_bullets?.length) && ["my_actions", "team_actions"].some((field) =>
      c[field as (typeof FACT_FIELDS)[number]].some((f) => f.status === "user_confirmed" && f.text.trim())))
  )).length;
}

export function needsExperienceDiscovery(db: ExperienceDB, state?: ExperienceDiscoveryState | null, selectedCardIds?: readonly string[]): boolean {
  return !discoveryState(state).exhausted && countExperiences(db, selectedCardIds) < TARGET_EXPERIENCES;
}

export function experienceQuestion(db: ExperienceDB, jd: JDAnalysis, state?: ExperienceDiscoveryState | null, selectedCardIds?: readonly string[]): string | null {
  if (!needsExperienceDiscovery(db, state, selectedCardIds)) return null;
  if (state?.followUp?.trim()) return state.followUp;
  const topics = jd.requirements.filter((r) => r.priority === "high").slice(0, 2).map((r) => r.text).join("、") || jd.role_title;
  return `目前保留 ${countExperiences(db, selectedCardIds)} 段经历，我们尽量补充到 ${TARGET_EXPERIENCES} 段。除了已经记录的经历，你还做过与「${topics}」相关、但没写进简历的小组作业、课程项目、个人项目、研究或实习吗？先选一段，说说项目是什么、你本人做了什么，以及用到的方法或结果。不需要有正式工作经验；确实没有其他经历也可以直接说“没有”。`;
}

export function isExplicitNoMoreExperiences(answer: string): boolean {
  const text = answer.trim().toLowerCase().replace(/[\s。！!，,；;]+/g, "");
  if (/[?？]|如果|假如|万一|不是没有|并非没有|不一定|可以吗|whatif/.test(text)) return false;
  if (/^(没有|没有了|没了|确实没有|确实没有了|想不起来了|no|none|nothingelse)$/.test(text)) return true;
  if (/(但是|不过|但|but)/.test(text)) return false;
  return /(?:没有|没做过|没参加过|想不出)(?:其他|更多|别的)(?:的)?(?:(?:相关|可补充|可以补充|能补充)(?:的)?)?(?:经历|项目|作业|了)/.test(text)
    || /(?:noother|nomore|(?:don'?t|donot)have(?:any)?other)(?:relevant)?(?:experiences?|projects?)/.test(text);
}
