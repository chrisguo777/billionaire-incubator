import { orderResumeCards, type ResumeSortMode } from "./resume-order";
import { assembleResume, checkBullet, normalizeRewrites, rankCards, type RewrittenCard } from "./pipeline";
import { findOriginal, repairOriginalBoundaries, normalizedBullet } from "./original-bullets";
import { selectResumeCards } from "./resume-selection";
import type { ExperienceDB, Gap, JDAnalysis } from "./schema";

import { bulletKey, needsBulletReview, type ReviewChoices } from "./review-types";

// Recheck user edits with the same rules as generated bullets; never trust client ok flags.
export function reviewResume(db: ExperienceDB, jd: JDAnalysis, gaps: Gap[], original: RewrittenCard[], choices: ReviewChoices, sortMode: ResumeSortMode = "relevance", selectedCardIds?: readonly string[]) {
  db = repairOriginalBoundaries(db);
  const ranked = selectResumeCards(rankCards(db, jd, gaps), selectedCardIds);
  const normalized = normalizeRewrites(db, ranked.filter((r) => r.included).map((r) => r.card_id), { cards: original });
  const rewritten = normalized.map((card) => ({
    ...card,
    bullets: card.bullets.map((bullet, index) => {
      const choice = choices[bulletKey(card.card_id, index, bullet.original_bullet_id, bullet.source_ids)];
      const text = (choice?.text ?? bullet.text).trim();
      const checked = checkBullet(db, text, bullet.source_ids, card.card_id);
      if (!text) { checked.ok = false; checked.issues.push("内容不能为空"); }
      return { ...bullet, text, ...checked };
    }),
  }));
  const statusFor = (cardId: string, b: RewrittenCard["bullets"][number], index: number) => {
    const source = findOriginal(db, cardId, b.original_bullet_id);
    // Old clients may have accepted/excluded an unchanged proposal. Such a row
    // now needs no decision: retain its exact source and never count it as a rewrite.
    if (source && !needsBulletReview(source.text, b.text)) return "pending";
    return choices[bulletKey(cardId, index, b.original_bullet_id, b.source_ids)]?.status ?? "pending";
  };
  // An accepted edit can accidentally copy another bullet. Reject the duplicate
  // replacement and keep its own original instead of silently deleting a row.
  // Each pass can only block more replacements, so the loop is bounded.
  const rows = rewritten.flatMap((card) => card.bullets.map((b, i) => ({
    b, cardId: card.card_id, affiliationId: db.cards.find((c) => c.id === card.card_id)?.affiliation_id,
    status: statusFor(card.card_id, b, i),
    source: findOriginal(db, card.card_id, b.original_bullet_id),
  })));
  for (let pass = 0; pass < rows.length; pass++) {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.status === "excluded") continue;
      const text = row.status === "accepted" && row.b.ok ? row.b.text : row.source?.text;
      if (!text) continue;
      const key = `${row.affiliationId}:${normalizedBullet(text)}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    let blocked = false;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const accepted = group.filter((r) => r.status === "accepted" && r.b.ok);
      const duplicates = group.length > accepted.length ? accepted : accepted.slice(1);
      for (const row of duplicates) {
        row.b.ok = false;
        row.b.issues.push("改写与同一经历的另一条内容重复，请编辑后再接受");
        blocked = true;
      }
    }
    if (!blocked) break;
  }
  const stats = { accepted: 0, retained: 0, excluded: 0, addedPending: 0 };
  const effective = rewritten.map((card) => ({
    ...card,
    bullets: card.bullets.flatMap((b, i) => {
      const status = statusFor(card.card_id, b, i);
      if (status === "excluded") { stats.excluded++; return []; }
      if (status === "accepted" && b.ok) { stats.accepted++; return [b]; }
      const source = findOriginal(db, card.card_id, b.original_bullet_id);
      if (source) {
        stats.retained++;
        return [{ ...b, text: source.text, source_ids: [source.id], ok: true, issues: [] }];
      }
      stats.addedPending++;
      return [];
    }),
  }));
  const resume = assembleResume(db, jd, gaps, effective, sortMode);
  for (const card of rewritten) for (const b of card.bullets) if (!b.ok && needsBulletReview(findOriginal(db, card.card_id, b.original_bullet_id)?.text, b.text)) {
    resume.warnings.push(`改写未通过校验，${findOriginal(db, card.card_id, b.original_bullet_id) ? "未排除时保留原句" : "新增内容未写入"}：「${b.text}」— ${b.issues.join("；")}`);
  }
  return { rewritten: orderResumeCards(rewritten, db, sortMode, ranked), resume, stats, ranked: orderResumeCards(ranked, db, sortMode, ranked) };
}

export type ReviewResult = ReturnType<typeof reviewResume>;
