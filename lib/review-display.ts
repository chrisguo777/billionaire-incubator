import { findOriginal } from "./original-bullets";
import { bulletKey, needsBulletReview } from "./review-types";
import type { ExperienceDB } from "./schema";
import type { RewrittenCard } from "./pipeline";

// Filter presentation only. Keep full source rows in the resume/review cache,
// and assign keys before filtering so hiding a row never shifts another choice.
export function reviewableCards(db: ExperienceDB, cards: RewrittenCard[]) {
  return cards.map((card) => ({
    card_id: card.card_id,
    rows: card.bullets.flatMap((bullet, index) => {
      const sourceBullet = findOriginal(db, card.card_id, bullet.original_bullet_id);
      if (!needsBulletReview(sourceBullet?.text, bullet.text)) return [];
      return [{ bullet, index, sourceBullet,
        key: bulletKey(card.card_id, index, bullet.original_bullet_id, bullet.source_ids) }];
    }),
  })).filter((card) => card.rows.length > 0);
}
