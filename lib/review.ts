import { orderResumeCards, type ResumeSortMode } from "./resume-order";
import { assembleResume, checkBullet, normalizeRewrites, rankCards, type RewrittenCard } from "./pipeline";
import { findOriginal, normalizedBullet } from "./original-bullets";
import type { ExperienceDB, Gap, JDAnalysis } from "./schema";

import { bulletKey, type ReviewChoices } from "./review-types";

// Recheck user edits with the same rules as generated bullets; never trust client ok flags.
export function reviewResume(db: ExperienceDB, jd: JDAnalysis, gaps: Gap[], original: RewrittenCard[], choices: ReviewChoices, sortMode: ResumeSortMode = "relevance") {
  const normalized = normalizeRewrites(db, original.map((c) => c.card_id), { cards: original });
  const rewritten = normalized.map((card) => ({
    ...card,
    bullets: card.bullets.map((bullet, index) => {
      const choice = choices[bulletKey(card.card_id, index, bullet.original_bullet_id)];
      const text = (choice?.text ?? bullet.text).trim();
      const checked = checkBullet(db, text, bullet.source_ids);
      if (!text) { checked.ok = false; checked.issues.push("内容不能为空"); }
      return { ...bullet, text, ...checked };
    }),
  }));
  // An accepted edit can accidentally copy another bullet. Reject the duplicate
  // replacement and keep its own original instead of silently deleting a row.
  // Each pass can only block more replacements, so the loop is bounded.
  const rows = rewritten.flatMap((card) => card.bullets.map((b, i) => ({
    b, cardId: card.card_id, affiliationId: db.cards.find((c) => c.id === card.card_id)?.affiliation_id,
    status: choices[bulletKey(card.card_id, i, b.original_bullet_id)]?.status ?? "pending",
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
      const status = choices[bulletKey(card.card_id, i, b.original_bullet_id)]?.status ?? "pending";
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
  for (const card of rewritten) for (const b of card.bullets) if (!b.ok) {
    resume.warnings.push(`改写未通过校验，${findOriginal(db, card.card_id, b.original_bullet_id) ? "未排除时保留原句" : "新增内容未写入"}：「${b.text}」— ${b.issues.join("；")}`);
  }
  return { rewritten: orderResumeCards(rewritten, db, sortMode, rankCards(db, jd, gaps)), resume, stats };
}

export type ReviewResult = ReturnType<typeof reviewResume>;
