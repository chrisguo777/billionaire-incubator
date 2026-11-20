import type { ExperienceDB, OriginalBullet } from "./schema";

// Punctuation (including semicolons/full stops) never divides a bullet. Wrapped
// lines stay together; blank lines, a new marker, or a section heading end it.
const MARKER = /^\s*(?:[-*+–—]\s+|[•●▪◦‣\uF0B7]\s*|\d{1,3}[.)、]\s+)(\S.*)$/u;
const SECTION = /^(?:EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EDUCATION|SKILLS|TECHNICAL SKILLS|PROJECTS|PROJECT EXPERIENCE|RESEARCH EXPERIENCE|RESEARCH|CERTIFICATIONS|工作经历|实习经历|项目经历|教育经历|专业技能)\s*[:：]?$/i;
const ROLE = /(?:\b(?:intern|assistant|analyst|engineer|researcher|manager|developer|consultant|volunteer|associate|designer|coordinator|leader|director)\b|实习|助理|分析师|工程师|负责人|协调员)/i;
const ACTION_START = /^(?:cleaned|built|developed|analyzed|analysed|communicated|conducted|coordinated|led|managed|worked|supported|presented|authored|created|designed|improved|reduced|increased|used|implemented|delivered|identified|validated|研究了|负责了|完成了|分析了|开发了|参与了)\b/i;

// PDF text often puts employer + dates and position + location on separate lines.
// Recognize the pair before joining wrapped bullet lines; keep both out of bullets.
export function experienceHeadingLines(cv: string): Set<number> {
  const lines = cv.replace(/\r\n?/g, "\n").split("\n");
  const headings = new Set<number>();
  const candidate = (s: string) => !!s.trim() && !MARKER.test(s) && !ACTION_START.test(s.trim()) && s.trim().length < 240;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (SECTION.test(line)) { headings.add(i); return; }
    if (!candidate(raw) || !/(?:19|20)\d{2}/.test(line)) return;
    const next = lines[i + 1] ?? "";
    const paired = candidate(next) && ROLE.test(next) && !/[.;。；]$/.test(next.trim());
    const single = ROLE.test(line) && /(?:[|｜–—]|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\d{4}\s*[-–—])/i.test(line) && !/[.;。；]$/.test(line);
    if (paired || single) {
      headings.add(i);
      if (paired) headings.add(i + 1);
    }
  });
  return headings;
}

// Fix cached pre-boundary originals without touching facts, IDs or review choices.
// Ambiguous tails are rejected rather than silently dropping possible bullet text.
export function repairOriginalBoundaries(db: ExperienceDB): ExperienceDB {
  let changed = false;
  const cards = db.cards.map(card => {
    if (!card.original_bullets?.length) return card;
    let cardChanged = false;
    const originals = card.original_bullets.map(b => {
      const lines = b.text.replace(/\r\n?/g, "\n").split("\n");
      const headers = experienceHeadingLines(b.text);
      const start = [...headers].sort((a,b) => a-b)[0];
      if (start === undefined) return b;
      if (start === 0 || lines.slice(start).some((line, offset) => line.trim() && !headers.has(start + offset))) {
        throw new Error("原句包含经历标题或跨越经历边界，无法安全恢复，请重新解析简历并核对后生成。");
      }
      changed = true; cardChanged = true;
      return { ...b, text: lines.slice(0, start).join("\n").trim() };
    });
    return cardChanged ? { ...card, original_bullets: originals } : card;
  });
  return changed ? { ...db, cards } : db;
}

export function extractOriginalBullets(cv: string): OriginalBullet[] {
  const blocks: OriginalBullet[] = [];
  let lines: string[] = [];
  let start = 0;
  const flush = () => {
    if (lines.length) blocks.push({ id: `cvb${start + 1}`, text: lines.join("\n").trim() });
    lines = [];
  };
  const headings = experienceHeadingLines(cv);
  cv.replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const match = raw.match(MARKER);
    // Some PDFs retain line breaks but no blank line before the next employer.
    const heading = headings.has(i);
    if (match || SECTION.test(line) || heading) flush();
    if (!lines.length) start = i;
    lines.push(match ? match[1] : line);
    // Section headings should not get attached to the following paragraph.
    if (SECTION.test(line) || heading) flush();
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
