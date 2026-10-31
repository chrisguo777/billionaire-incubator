import type { ExperienceDB } from "./schema";

export type ResumeSortMode = "relevance" | "chronological";
export function isResumeSortMode(value: unknown): value is ResumeSortMode {
  return value === "relevance" || value === "chronological";
}
export const SORT_LABELS: Record<ResumeSortMode, string> = {
  relevance: "按 JD 匹配度（重要的在前）",
  chronological: "按经历时间（最近的在前）",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Read dates without relying on browser/OS-specific Date.parse or guessing a missing month.
export function dateOrder(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const text = value.trim().toLowerCase();
  const years = text.match(/\b(?:19|20|21)\d{2}\b/g) ?? text.match(/(?:19|20|21)\d{2}(?=年)/g);
  if (!years || years.length !== 1) return null;
  const year = Number(years[0]);
  let month = 0;
  let day = 0;
  const iso = text.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?月?$/);
  const monthYear = text.match(/^(\d{1,2})[/-](\d{4})$/);
  const english = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b/);
  if (iso) { month = Number(iso[2]); day = Number(iso[3] ?? 0); }
  else if (monthYear) month = Number(monthYear[1]);
  else if (english) month = MONTHS.indexOf(english[1].slice(0, 3)) + 1;
  if (month < 0 || month > 12 || ((iso || monthYear) && month === 0)) return null;
  if (day && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return null;
  return year * 10000 + month * 100 + day;
}

function ongoing(value: string | null | undefined) {
  return !!value && /^(present|current|currently|now|ongoing|至今|现在|目前|在职|进行中)$/i.test(value.trim());
}

export function orderResumeCards<T extends { card_id: string }>(
  cards: readonly T[], db: ExperienceDB, mode: ResumeSortMode,
  ranked: readonly { card_id: string; score: number }[],
): T[] {
  const originalPositions = new Map(db.cards.map((card, index) => [card.id, index]));
  const scores = new Map(ranked.map((r) => [r.card_id, r.score]));
  const affiliations = new Map(db.affiliations.map((a) => [a.id, a]));
  const experiences = new Map(db.cards.map((c) => [c.id, affiliations.get(c.affiliation_id)]));
  const descending = (a: number, b: number) => a > b ? -1 : a < b ? 1 : 0;
  return cards.map((card, index) => {
    const affiliation = experiences.get(card.card_id);
    const start = dateOrder(affiliation?.start_date);
    const end = ongoing(affiliation?.end_date) ? Infinity : dateOrder(affiliation?.end_date);
    return { card, index, score: scores.get(card.card_id) ?? -Infinity, end: end ?? start ?? -Infinity, start: start ?? -Infinity };
  }).sort((a, b) => {
    if (mode === "chronological") {
      const dateDifference = descending(a.end, b.end) || descending(a.start, b.start);
      if (dateDifference) return dateDifference;
    }
    return descending(a.score, b.score) || (originalPositions.get(a.card.card_id) ?? Infinity) - (originalPositions.get(b.card.card_id) ?? Infinity) || a.index - b.index;
  }).map((entry) => entry.card);
}
