import { callStructured, getMode } from "./llm";
import {
  mockAnalyzeJD,
  mockExtract,
  mockMatch,
  mockParseCV,
  mockQuestion,
  mockRewrite,
} from "./mock";
import {
  AnswerExtraction,
  FACT_FIELDS,
  JDAnalysis,
  MatchOutput,
  ParsedCV,
  QuestionOutput,
  RewriteOutput,
  type Asked,
  type Card,
  type Education,
  type ExperienceDB,
  type Fact,
  type FactField,
  type Gap,
  type Outcome,
  type Requirement,
} from "./schema";
import { docToMarkdown, type ResumeDoc, type ResumeEntry, type ResumeSection } from "./resume-doc";
import { checkStandards, type StandardCheck } from "./standards";

const live = () => getMode() === "live";

// ---------- helpers ----------

function maxNum(db: ExperienceDB): number {
  let max = 0;
  const bump = (id: string) => {
    const n = parseInt(id.replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  };
  for (const c of db.cards) {
    bump(c.id);
    for (const f of FACT_FIELDS) c[f].forEach((x) => bump(x.id));
    c.outcomes.forEach((o) => bump(o.id));
  }
  db.affiliations.forEach((a) => bump(a.id));
  (db.education ?? []).forEach((e) => bump(e.id));
  return max;
}

export function renderDB(db: ExperienceDB): string {
  return db.cards
    .map((c) => {
      const aff = db.affiliations.find((a) => a.id === c.affiliation_id);
      const lines = [`[${c.id}] ${c.name} | ${aff?.organization ?? ""} | ${aff?.type ?? ""} | role: ${c.my_role ?? "-"}`];
      for (const f of FACT_FIELDS) {
        for (const x of c[f]) lines.push(`  ${f}: [${x.id}] ${x.text} (${x.status})`);
      }
      for (const o of c.outcomes) {
        lines.push(`  outcomes: [${o.id}] ${o.note} value=${o.value ?? "null"} unit=${o.unit ?? "null"} basis=${o.basis ?? "null"} (${o.status})`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function renderJD(jd: JDAnalysis): string {
  return jd.requirements.map((r) => `[${r.id}] (${r.kind}, ${r.priority}) ${r.text}`).join("\n");
}

type Located = { kind: "fact"; fact: Fact; card: Card; field: FactField } | { kind: "outcome"; outcome: Outcome; card: Card };

export function indexFacts(db: ExperienceDB): Map<string, Located> {
  const m = new Map<string, Located>();
  for (const card of db.cards) {
    for (const field of FACT_FIELDS) for (const fact of card[field]) m.set(fact.id, { kind: "fact", fact, card, field });
    for (const outcome of card.outcomes) m.set(outcome.id, { kind: "outcome", outcome, card });
  }
  return m;
}

// ---------- 1-3: Resume parsing -> initial Experience DB ----------

export async function parseCV(cvText: string): Promise<ExperienceDB> {
  const parsed: ParsedCV = live()
    ? await callStructured(
        ParsedCV,
        [
          "You convert a resume into a structured experience database.",
          "Rules: use ONLY information present in the resume text. Never infer, add, or embellish facts or numbers.",
          "Split each bullet into the right field: context (situation/problem), my_actions (what the candidate personally did), team_actions (what the team did), methods, tools, skills, scale (sizes, counts, durations), outcomes (results; value only if a number is stated).",
          "If a bullet describes team work without saying what the candidate did, put it in team_actions, not my_actions.",
          "Put the resume's skills section into one affiliation with type 'skills_list' and one card whose 'skills' field holds each skill.",
          "Put degrees and schools into the separate 'education' list, never into affiliations. Fill gpa, location, dates and details (honors, relevant coursework, thesis) only when the resume states them; otherwise use null or an empty list. Keep the resume's wording for dates such as 'expected 2027'.",
          "Keep the original wording of each fact as close as possible.",
        ].join("\n"),
        cvText,
      )
    : mockParseCV();

  const db: ExperienceDB = { affiliations: [], cards: [], education: [] };
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  for (const e of parsed.education ?? []) db.education.push({ id: id("e"), ...e });
  for (const a of parsed.affiliations) {
    const aff = { id: id("a"), organization: a.organization, title: a.title, type: a.type, start_date: a.start_date, end_date: a.end_date };
    db.affiliations.push(aff);
    for (const c of a.cards) {
      const card: Card = {
        id: id("c"),
        affiliation_id: aff.id,
        name: c.name,
        my_role: c.my_role,
        context: [],
        my_actions: [],
        team_actions: [],
        methods: [],
        tools: [],
        skills: [],
        scale: [],
        outcomes: [],
      };
      for (const f of FACT_FIELDS) {
        card[f] = c[f].map((text) => ({ id: id("f"), text, status: "user_confirmed" as const, source: "cv_parse" as const }));
      }
      card.outcomes = c.outcomes.map((o) => ({ id: id("o"), ...o, status: "user_confirmed" as const, source: "cv_parse" as const }));
      db.cards.push(card);
    }
  }
  return db;
}

// ---------- 5: JD analysis ----------

export async function analyzeJD(jdText: string): Promise<JDAnalysis> {
  if (!live()) return mockAnalyzeJD();
  return callStructured(
    JDAnalysis,
    [
      "You analyze a job description into discrete, checkable requirements.",
      "Give each requirement a short id (r1, r2, ...), a concise text, a kind (must_have, preferred, responsibility), a priority (high, medium, low) and 2-6 lowercase keywords.",
      "Do not merge unrelated requirements and do not invent requirements that are not in the JD.",
    ].join("\n"),
    jdText,
  );
}

// ---------- 6-7: Matching + gap detection ----------

export async function matchExperience(db: ExperienceDB, jd: JDAnalysis): Promise<MatchOutput> {
  if (!live()) return mockMatch(db, jd);
  return callStructured(
    MatchOutput,
    [
      "You match job requirements against a candidate's experience database.",
      "For each requirement, list evidence_fact_ids: ids of facts or outcomes (like f3, o1) that genuinely show the candidate did this. Cite only ids that appear in the database. If nothing supports it, return an empty list.",
      "related_card_ids: cards that are related to the requirement even if they lack detail.",
      "Do not stretch: a tool merely listed in a skills section is weaker evidence than something the candidate did. Return one match per requirement.",
    ].join("\n"),
    `REQUIREMENTS\n${renderJD(jd)}\n\nEXPERIENCE DATABASE\n${renderDB(db)}`,
  );
}

export function detectGaps(db: ExperienceDB, jd: JDAnalysis, m: MatchOutput, asked: Asked): Gap[] {
  const index = indexFacts(db);
  return jd.requirements.map((r) => {
    const match = m.matches.find((x) => x.requirement_id === r.id);
    const cited = (match?.evidence_fact_ids ?? []).filter((id) => index.has(id));
    const confirmed = cited.filter((id) => {
      const l = index.get(id)!;
      return (l.kind === "fact" ? l.fact.status : l.outcome.status) === "user_confirmed";
    });
    const related = [...new Set([...(match?.related_card_ids ?? []), ...cited.map((id) => index.get(id)!.card.id)])];

    const base = { requirement_id: r.id, evidence_fact_ids: confirmed, related_card_ids: related };
    // The user's own "I have no such experience" outranks whatever the matcher found.
    if (asked[r.id] === "none") {
      return { ...base, status: "true_gap" as const, reason: "已向你确认过：没有相关经历" };
    }

    let coveredCard: Card | null = null;
    for (const id of confirmed) {
      const l = index.get(id)!;
      if (l.kind === "fact" && l.field === "my_actions" && l.card.outcomes.some((o) => o.status === "user_confirmed")) {
        coveredCard = l.card;
        break;
      }
    }

    if (coveredCard) {
      return { ...base, status: "covered" as const, reason: `「${coveredCard.name}」里有你本人的动作和已确认的结果` };
    }
    if (confirmed.length > 0) {
      const hasAction = confirmed.some((id) => {
        const l = index.get(id)!;
        return l.kind === "fact" && l.field === "my_actions";
      });
      return {
        ...base,
        status: "weak" as const,
        reason: hasAction ? "有你的动作，但缺少已确认的结果/数据" : "只有技能/工具层面的证据，缺少你本人做了什么",
      };
    }
    return {
      ...base,
      status: "unknown" as const,
      reason: related.length ? "有相关经历，但细节不足以判断" : "经历库里没有找到证据，需要先问你是否做过",
    };
  });
}

// ---------- 8: Targeted interview ----------

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function pickGap(gaps: Gap[], jd: JDAnalysis, asked: Asked): Gap | null {
  const reqOf = (g: Gap) => jd.requirements.find((r) => r.id === g.requirement_id)!;
  const candidates = gaps
    .filter((g) => (g.status === "weak" || g.status === "unknown") && !asked[g.requirement_id])
    .sort((a, b) => {
      const pa = PRIORITY_RANK[reqOf(a).priority];
      const pb = PRIORITY_RANK[reqOf(b).priority];
      if (pa !== pb) return pa - pb;
      if (a.status !== b.status) return a.status === "weak" ? -1 : 1;
      return 0;
    });
  return candidates[0] ?? null;
}

export interface QA {
  question: string;
  answer: string;
}

export async function askQuestion(db: ExperienceDB, gap: Gap, req: Requirement, history: QA[] = []): Promise<string> {
  if (!live()) return mockQuestion(gap, req);
  const earlier = history.length
    ? history.map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`).join("\n\n")
    : "(none)";
  const related = db.cards.filter((c) => gap.related_card_ids.includes(c.id));
  const out = await callStructured(
    QuestionOutput,
    [
      "You interview a job seeker to uncover real experience for their resume.",
      "Ask exactly ONE question in Chinese, specific to the requirement and to what is already known. Keep it concise: at most 3 short sentences, about 80 Chinese characters.",
      "Structure: (1) name the specific experience and ask the core question; (2) optionally list the quantifiable details that would help, as short nouns. Do not add reassurance phrases such as '没有也没关系'.",
      "No filler or small talk (e.g. '我很好奇', '比如', '跟我说说', '完全'). Do not restate background the user already knows.",
      "Example of the target style (copy the length and structure only, never its content): 你在瑞德赛恩的回归分析影响了哪个决定？有没有哪条保护策略因你的结论被提出或采纳？数据量、关键发现、报告使用方等如有可量化信息也请说明。",
      "If the status is 'weak', ask for the missing specifics (what they personally did, tools/methods, a measurable result). If 'unknown', first ask whether they have done anything like it.",
      "Never suggest numbers or claims for the user to adopt. Do not mention internal terms like status or gap.",
      "The user has already answered the earlier questions listed below. Never ask again about anything they already answered (including tools or topics they said they have not used); if the requirement overlaps with an earlier answer, narrow the question to what is still unknown, and do not mention tools or topics they already ruled out.",
    ].join("\n"),
    `REQUIREMENT: ${req.text}\nSTATUS: ${gap.status}\nREASON: ${gap.reason}\n\nEARLIER QUESTIONS AND ANSWERS\n${earlier}\n\nRELATED EXPERIENCE\n${related.length ? renderDB({ affiliations: db.affiliations, cards: related, education: [] }) : "(none)"}`,
  );
  return out.question;
}

export interface AppliedAnswer {
  db: ExperienceDB;
  asked: Asked;
  added_ids: string[];
  has_experience: boolean;
}

export async function applyAnswer(
  db: ExperienceDB,
  gap: Gap,
  req: Requirement,
  question: string,
  answer: string,
  asked: Asked,
): Promise<AppliedAnswer> {
  const extraction: AnswerExtraction = live()
    ? await callStructured(
        AnswerExtraction,
        [
          "You are a meticulous note-taker. Convert the user's answer into structured facts for their experience database.",
          "Record ONLY what the user actually said. Do not add, round, or infer numbers. If a result has no stated number, set value to null.",
          "If the user says they have no such experience, set has_experience=false and leave the rest empty.",
          "Attach to an existing card via target_card_id when the answer is about it; otherwise set new_card_name and leave target_card_id null.",
          "Write facts in the user's language, short and factual.",
        ].join("\n"),
        `QUESTION: ${question}\nREQUIREMENT: ${req.text}\nRELATED CARD IDS: ${gap.related_card_ids.join(", ") || "(none)"}\n\nEXPERIENCE DATABASE\n${renderDB(db)}\n\nUSER ANSWER\n${answer}`,
      )
    : mockExtract(answer, gap);

  const next: ExperienceDB = structuredClone(db);
  const nextAsked: Asked = { ...asked };
  if (!extraction.has_experience) {
    nextAsked[req.id] = "none";
    return { db: next, asked: nextAsked, added_ids: [], has_experience: false };
  }
  nextAsked[req.id] = "answered";

  let n = maxNum(next);
  const id = (p: string) => `${p}${++n}`;
  let card = next.cards.find((c) => c.id === extraction.target_card_id);
  if (!card) {
    let aff = next.affiliations.find((a) => a.organization === "Added during interview");
    if (!aff) {
      aff = { id: id("a"), organization: "Added during interview", title: null, type: "other", start_date: null, end_date: null };
      next.affiliations.push(aff);
    }
    card = {
      id: id("c"),
      affiliation_id: aff.id,
      name: extraction.new_card_name ?? "New experience",
      my_role: null,
      context: [],
      my_actions: [],
      team_actions: [],
      methods: [],
      tools: [],
      skills: [],
      scale: [],
      outcomes: [],
    };
    next.cards.push(card);
  }
  const added: string[] = [];
  for (const f of extraction.new_facts) {
    const fact: Fact = { id: id("f"), text: f.text, status: "user_confirmed", source: "dialogue" };
    card[f.field].push(fact);
    added.push(fact.id);
  }
  for (const o of extraction.new_outcomes) {
    // Numbers coming out of a conversation stay unconfirmed until the user clicks confirm.
    const outcome: Outcome = { id: id("o"), ...o, status: "ai_inferred", source: "dialogue" };
    card.outcomes.push(outcome);
    added.push(outcome.id);
  }
  return { db: next, asked: nextAsked, added_ids: added, has_experience: true };
}

// ---------- 10: Selection & ranking ----------

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;
const STATUS_FACTOR = { covered: 1, weak: 0.5 } as const;
const UNKNOWN_FACTOR = 0.25;

export type MatchLevel = "covered" | "weak" | "unknown" | "none";

export interface RankedCard {
  card_id: string;
  rank: number; // 1 = 与 JD 最匹配，简历里排在最前
  score: number; // 有证据的匹配得分（已覆盖 / 偏弱）
  related_score: number; // 相关但证据不足（未知）的得分，只用于排序，排在有证据的经历之后
  level: MatchLevel;
  included: boolean;
  reasons: string[];
}

// 所有经历都进入简历，不因为证据不足或与 JD 无关而落选；匹配度只决定顺序。
// 排序先看有证据的得分，再看相关但证据不足的得分，同分保持原简历顺序。
export function rankCards(db: ExperienceDB, jd: JDAnalysis, gaps: Gap[]): RankedCard[] {
  const index = indexFacts(db);
  const ranked = db.cards
    .filter((c) => db.affiliations.find((a) => a.id === c.affiliation_id)?.type !== "skills_list")
    .map((card) => {
      let score = 0;
      let related = 0;
      const reasons: string[] = [];
      for (const g of gaps) {
        const req = jd.requirements.find((r) => r.id === g.requirement_id);
        if (!req) continue;
        if (g.status === "covered" || g.status === "weak") {
          const hits = g.evidence_fact_ids.filter((id) => index.get(id)?.card.id === card.id);
          if (!hits.length) continue;
          score += WEIGHT[req.priority] * STATUS_FACTOR[g.status];
          reasons.push(`${g.status === "covered" ? "覆盖" : "部分覆盖"}：${req.text}`);
        } else if (g.status === "unknown" && g.related_card_ids.includes(card.id)) {
          related += WEIGHT[req.priority] * UNKNOWN_FACTOR;
          reasons.push(`相关但证据不足：${req.text}`);
        }
      }
      const level: MatchLevel = reasons.some((r) => r.startsWith("覆盖"))
        ? "covered"
        : score > 0
          ? "weak"
          : related > 0
            ? "unknown"
            : "none";
      return { card_id: card.id, rank: 0, score, related_score: related, level, included: true, reasons };
    })
    .sort((a, b) => b.score - a.score || b.related_score - a.related_score);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return ranked;
}

/** 一条 bullet 支撑的 JD 要求越重要，得分越高；用于同一段经历内部的排序。 */
export function bulletRelevance(jd: JDAnalysis, gaps: Gap[], sourceIds: string[]): number {
  let score = 0;
  for (const g of gaps) {
    if (g.status !== "covered" && g.status !== "weak") continue;
    if (!g.evidence_fact_ids.some((id) => sourceIds.includes(id))) continue;
    const req = jd.requirements.find((r) => r.id === g.requirement_id);
    if (req) score += WEIGHT[req.priority] * STATUS_FACTOR[g.status];
  }
  return score;
}

// ---------- 11: Bullet rewrite + faithfulness check ----------

export interface CheckedBullet {
  text: string;
  source_ids: string[];
  ok: boolean;
  issues: string[];
}

export interface RewrittenCard {
  card_id: string;
  bullets: CheckedBullet[];
}

const NUM = /\d+(?:[.,]\d+)?/g;

function sourceText(l: Located): string {
  return l.kind === "fact" ? l.fact.text : `${l.outcome.note} ${l.outcome.value ?? ""} ${l.outcome.unit ?? ""}`;
}

export function checkBullet(db: ExperienceDB, text: string, sourceIds: string[]): { ok: boolean; issues: string[] } {
  const index = indexFacts(db);
  const issues: string[] = [];
  if (!sourceIds.length) issues.push("没有标注事实来源");
  let allowed = "";
  for (const id of sourceIds) {
    const l = index.get(id);
    if (!l) {
      issues.push(`引用了不存在的事实 ${id}`);
      continue;
    }
    const status = l.kind === "fact" ? l.fact.status : l.outcome.status;
    if (status !== "user_confirmed") issues.push(`引用了未确认的事实 ${id}`);
    allowed += " " + sourceText(l);
  }
  const allowedNums = new Set((allowed.match(NUM) ?? []).map((n) => n.replace(/,/g, "")));
  for (const n of text.match(NUM) ?? []) {
    if (!allowedNums.has(n.replace(/,/g, ""))) issues.push(`数字 ${n} 不在所引用的已确认事实中`);
  }
  return { ok: issues.length === 0, issues };
}

// cardIds 按匹配度从高到低传入；输出保持这个顺序，每段经历内部的 bullet 也按支撑的要求重要程度排序。
export async function rewriteBullets(
  db: ExperienceDB,
  jd: JDAnalysis,
  cardIds: string[],
  gaps: Gap[] = [],
): Promise<RewrittenCard[]> {
  const confirmedOnly: ExperienceDB = {
    affiliations: db.affiliations,
    education: [],
    cards: db.cards
      .filter((c) => cardIds.includes(c.id))
      .map((c) => {
        const copy: Card = structuredClone(c);
        for (const f of FACT_FIELDS) copy[f] = copy[f].filter((x) => x.status === "user_confirmed");
        copy.outcomes = copy.outcomes.filter((o) => o.status === "user_confirmed");
        return copy;
      }),
  };
  const out: RewriteOutput = live()
    ? await callStructured(
        RewriteOutput,
        [
          "You write resume bullets for a specific job, using ONLY the confirmed facts provided.",
          "Format: strong action verb + what was done + method/tool + result. One line each, 2-4 bullets per card, English.",
          "Resume standard: start every bullet with an action verb (past tense; present tense only for ongoing roles); avoid weak openers such as 'Responsible for', 'Helped', 'Assisted', 'Worked on', 'Participated in'; no first-person pronouns (I, my, we, our); at most 25 words; do not start two bullets in the same card with the same verb; no period at the end.",
          "Hard rules: never add facts, tools, numbers, scope or ownership that are not in the cited facts. Never upgrade ownership just to get a stronger verb (e.g. participated -> led). Do not turn team actions into personal actions. Every bullet must list source_ids (the fact/outcome ids it relies on).",
          "Prefer wording that reflects the job's requirements only where it is truthful for the candidate.",
          "Write bullets for every card listed, even cards with little match to the job; describe what the candidate did faithfully.",
        ].join("\n"),
        `JOB REQUIREMENTS\n${renderJD(jd)}\n\nCONFIRMED FACTS\n${renderDB(confirmedOnly)}`,
        "medium",
      )
    : mockRewrite(confirmedOnly, cardIds);

  return out.cards
    .filter((c) => cardIds.includes(c.card_id))
    .sort((a, b) => cardIds.indexOf(a.card_id) - cardIds.indexOf(b.card_id))
    .map((c) => ({
      card_id: c.card_id,
      bullets: c.bullets
        .map((b) => ({ ...b, ...checkBullet(db, b.text, b.source_ids) }))
        .sort((a, b) => bulletRelevance(jd, gaps, b.source_ids) - bulletRelevance(jd, gaps, a.source_ids)),
    }));
}

// ---------- 12: Assemble the targeted resume ----------

export interface ResumeOutput {
  markdown: string;
  doc: ResumeDoc;
  standards: StandardCheck[];
  warnings: string[];
  coverage: Record<string, number>;
}

// 教育经历直接照搬 CV 解析结果，不经过 AI 改写，所以不需要事实校验。
export function educationEntries(education: Education[]): ResumeEntry[] {
  return education.map((e) => ({
    title: e.school,
    location: e.location,
    subtitle: [e.degree, e.field].filter(Boolean).join(", "),
    dates: [e.start_date, e.end_date].filter(Boolean).join(" – "),
    bullets: [...(e.gpa ? [`GPA: ${e.gpa}`] : []), ...e.details],
  }));
}

// rewritten 已按匹配度排好顺序，这里按原顺序拼装。
export function assembleResume(
  db: ExperienceDB,
  jd: JDAnalysis,
  gaps: Gap[],
  rewritten: RewrittenCard[],
): ResumeOutput {
  const sections: ResumeSection[] = [];
  const education = educationEntries(db.education ?? []);
  if (education.length) sections.push({ heading: "EDUCATION", entries: education, text: null });

  const experience: ResumeEntry[] = [];
  for (const rc of rewritten) {
    const card = db.cards.find((c) => c.id === rc.card_id);
    if (!card) continue;
    const aff = db.affiliations.find((a) => a.id === card.affiliation_id);
    const okBullets = rc.bullets.filter((b) => b.ok);
    if (!okBullets.length) continue;
    experience.push({
      title: card.name,
      location: null,
      subtitle: [aff?.title, aff?.organization].filter(Boolean).join(", "),
      dates: [aff?.start_date, aff?.end_date].filter(Boolean).join(" – "),
      bullets: okBullets.map((b) => b.text),
    });
  }
  sections.push({ heading: "EXPERIENCE", entries: experience, text: null });

  const skillsCard = db.cards.find((c) => db.affiliations.find((a) => a.id === c.affiliation_id)?.type === "skills_list");
  const keywords = jd.requirements.flatMap((r) => r.keywords);
  const skills = (skillsCard?.skills ?? [])
    .filter((s) => s.status === "user_confirmed")
    .sort((a, b) => Number(keywords.some((k) => b.text.toLowerCase().includes(k))) - Number(keywords.some((k) => a.text.toLowerCase().includes(k))));
  if (skills.length) sections.push({ heading: "SKILLS", entries: [], text: skills.map((s) => s.text).join(", ") });

  const doc: ResumeDoc = { title: `Targeted resume — ${jd.role_title}`, sections };

  const warnings: string[] = [];
  for (const rc of rewritten) for (const b of rc.bullets) if (!b.ok) warnings.push(`已拦截一条 bullet：「${b.text}」— ${b.issues.join("；")}`);
  for (const c of db.cards) for (const o of c.outcomes) if (o.status !== "user_confirmed") warnings.push(`「${c.name}」里的结果「${o.note}」尚未确认，没有写入简历`);
  const coverage: Record<string, number> = { covered: 0, weak: 0, unknown: 0, true_gap: 0 };
  for (const g of gaps) coverage[g.status]++;
  return { markdown: docToMarkdown(doc), doc, standards: checkStandards(doc, jd), warnings, coverage };
}
