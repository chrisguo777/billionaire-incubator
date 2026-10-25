import { assembleResume, checkBullet, type RewrittenCard } from "./pipeline";
import type { ExperienceDB, Gap, JDAnalysis } from "./schema";

import { bulletKey, type ReviewChoices } from "./review-types";

// Recheck user edits with the same rules as generated bullets; never trust client ok flags.
export function reviewResume(db: ExperienceDB, jd: JDAnalysis, gaps: Gap[], original: RewrittenCard[], choices: ReviewChoices) {
  const rewritten = original.map((card) => ({
    ...card,
    bullets: card.bullets.map((bullet, index) => {
      const choice = choices[bulletKey(card.card_id, index)];
      const text = (choice?.text ?? bullet.text).trim();
      const checked = checkBullet(db, text, bullet.source_ids);
      if (!text) { checked.ok = false; checked.issues.push("内容不能为空"); }
      return { ...bullet, text, ...checked };
    }),
  }));
  const accepted = rewritten.map((card) => ({
    ...card,
    bullets: card.bullets.filter((b, i) => b.ok && choices[bulletKey(card.card_id, i)]?.status === "accepted"),
  }));
  return { rewritten, resume: assembleResume(db, jd, gaps, accepted) };
}
