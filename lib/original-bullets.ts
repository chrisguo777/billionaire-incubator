import type { ExperienceDB, OriginalBullet } from "./schema";

// Punctuation (including semicolons/full stops) never divides a bullet. Wrapped
// lines stay together; blank lines, a new marker, or a section heading end it.
const MARKER = /^\s*(?:[-*+–—]\s+|[•●▪◦‣\uF0B7]\s*|\d{1,3}[.)、]\s+)(\S.*)$/u;
const SECTION = /^(?:EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EDUCATION|SKILLS|TECHNICAL SKILLS|PROJECTS|RESEARCH|CERTIFICATIONS|工作经历|实习经历|项目经历|教育经历|专业技能)\s*[:：]?$/i;
const DATED_ROLE = /(?:intern|assistant|analyst|engineer|researcher|manager|developer|consultant|volunteer|associate|designer|实习|助理|分析师|工程师)/i;

export function extractOriginalBullets(cv: string): OriginalBullet[] {
  const blocks: OriginalBullet[] = [];
  let lines: string[] = [];
  let start = 0;
  const flush = () => {
    if (lines.length) blocks.push({ id: `cvb${start + 1}`, text: lines.join("\n").trim() });
    lines = [];
  };
  cv.replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const match = raw.match(MARKER);
    // Some PDFs retain line breaks but no blank line before the next employer.
    const heading = !/^\s/.test(raw) && DATED_ROLE.test(line) && /(?:19|20)\d{2}/.test(line) && /[|｜—]/.test(line);
    if (match || SECTION.test(line) || heading) flush();
    if (!lines.length) start = i;
    lines.push(match ? match[1] : line);
    // Section headings should not get attached to the following paragraph.
    if (SECTION.test(line)) flush();
  });
  flush();
  return blocks;
}

export function renderOriginalBullets(bullets: OriginalBullet[]): string {
  return bullets.map((b) => `[${b.id}]\n${b.text}`).join("\n\n");
}

export const normalizedBullet = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!。！]+$/, "");

// Ownership is deterministic. The same source bullet cannot become two review
// rows just because parsing split one experience into several cards.
export function uniqueOriginals(db: ExperienceDB, cardIds: string[]): Map<string, OriginalBullet[]> {
  const seen = new Set<string>();
  const result = new Map<string, OriginalBullet[]>();
  for (const card of db.cards.filter((c) => cardIds.includes(c.id))) {
    const originals = (card.original_bullets ?? []).filter((b) => {
      const key = `${card.affiliation_id}:${normalizedBullet(b.text)}`;
      if (!b.text.trim() || seen.has(b.id) || seen.has(key)) return false;
      seen.add(b.id); seen.add(key);
      return true;
    });
    result.set(card.id, originals);
  }
  return result;
}

export function findOriginal(db: ExperienceDB, cardId: string, id?: string | null): OriginalBullet | undefined {
  return id ? db.cards.find((c) => c.id === cardId)?.original_bullets?.find((b) => b.id === id) : undefined;
}
