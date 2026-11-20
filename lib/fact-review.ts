import { FACT_FIELDS, type AffiliationType, type Education, type ExperienceDB, type Fact, type Outcome } from "./schema";

export const SOURCE_LABEL = { cv_parse: "来自原简历", dialogue: "来自追问回答", user_edit: "本人填写 / 修改" };

function idSequence(db: ExperienceDB) {
  const ids = [...db.affiliations, ...db.education, ...db.cards, ...reviewFacts(db)].map((item) => Number(item.id.replace(/\D/g, "")) || 0);
  let n = Math.max(0, ...ids);
  return (prefix: string) => `${prefix}${++n}`;
}

const optional = (text: string | null) => text?.trim() || null;

export function addEducation(db: ExperienceDB, draft: Omit<Education, "id">): ExperienceDB {
  if (!draft.school.trim()) throw new Error("请填写学校名称。");
  const education: Education = { ...draft, id: idSequence(db)("e"), school: draft.school.trim(),
    degree: optional(draft.degree), field: optional(draft.field), location: optional(draft.location),
    start_date: optional(draft.start_date), end_date: optional(draft.end_date), gpa: optional(draft.gpa),
    details: draft.details.map((s) => s.trim()).filter(Boolean) };
  return { ...db, education: [...db.education, education] };
}

export interface NewExperience {
  name: string; organization: string; title: string; type: AffiliationType;
  start_date: string; end_date: string; actions: string[]; outcomes: string[];
}

export function addExperience(db: ExperienceDB, draft: NewExperience): ExperienceDB {
  const actions = draft.actions.map((s) => s.trim()).filter(Boolean);
  if (!draft.name.trim() || !actions.length) throw new Error("请填写经历名称和至少一条本人做过的事。");
  const id = idSequence(db);
  const affiliation = { id: id("a"), organization: draft.organization.trim(), title: optional(draft.title),
    title_is_position: !!draft.title.trim(), type: draft.type, start_date: optional(draft.start_date), end_date: optional(draft.end_date) };
  const card = { id: id("c"), affiliation_id: affiliation.id, name: draft.name.trim(), my_role: affiliation.title,
    context: [], my_actions: actions.map((text) => ({ id: id("f"), text, status: "ai_inferred" as const, source: "user_edit" as const })),
    team_actions: [], methods: [], tools: [], skills: [], scale: [],
    outcomes: draft.outcomes.map((s) => s.trim()).filter(Boolean).map((note) => ({ id: id("o"), note, value: null, unit: null, basis: null, status: "ai_inferred" as const, source: "user_edit" as const })),
    original_bullets: [] };
  return { ...db, affiliations: [...db.affiliations, affiliation], cards: [...db.cards, card] };
}

export function reviewFacts(db: ExperienceDB): (Fact | Outcome)[] {
  return db.cards.flatMap((c) => [...FACT_FIELDS.flatMap((f) => c[f]), ...c.outcomes]);
}

// The parser's interpretation is a draft, even when its input was written by the user.
export function beginFactReview(db: ExperienceDB): ExperienceDB {
  const next = structuredClone(db);
  for (const f of reviewFacts(next)) f.status = "ai_inferred";
  return next;
}

export function confirmFacts(db: ExperienceDB, ids: string[]): ExperienceDB {
  const next = structuredClone(db);
  for (const f of reviewFacts(next)) if (ids.includes(f.id)) f.status = "user_confirmed";
  return next;
}

export function deleteAffiliation(db: ExperienceDB, affiliationId: string): ExperienceDB {
  if (!db.affiliations.some((a) => a.id === affiliationId)) return db;
  return {
    ...db,
    affiliations: db.affiliations.filter((a) => a.id !== affiliationId),
    cards: db.cards.filter((c) => c.affiliation_id !== affiliationId),
  };
}

// Keep the existing schema. Clearing (not undefining) originals prevents ensureOriginalBullets
// from importing superseded text again; new suggestions must use remaining confirmed facts.
export function changeFact(db: ExperienceDB, id: string, replacement: Fact | Outcome | null): ExperienceDB {
  const next = structuredClone(db);
  const removedOriginals = new Set<string>();
  for (const card of next.cards) {
    let changed = false;
    for (const field of FACT_FIELDS) card[field] = card[field].flatMap((f) => {
      if (f.id !== id) return [f];
      changed = true;
      return replacement ? [{ ...replacement, id, status: "ai_inferred", source: "user_edit" } as Fact] : [];
    });
    card.outcomes = card.outcomes.flatMap((o) => {
      if (o.id !== id) return [o];
      changed = true;
      return replacement ? [{ ...replacement, id, status: "ai_inferred", source: "user_edit" } as Outcome] : [];
    });
    if (changed) {
      for (const b of card.original_bullets ?? []) removedOriginals.add(b.id);
      card.original_bullets = [];
    }
  }
  // The parser can assign one source block to several cards in the same affiliation.
  for (const card of next.cards) if (card.original_bullets) card.original_bullets = card.original_bullets.filter((b) => !removedOriginals.has(b.id));
  return next;
}
