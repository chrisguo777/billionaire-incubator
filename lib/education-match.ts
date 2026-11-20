import type { Education, ExperienceDB, Gap, Requirement } from "./schema";

// Education is a qualification check, never an interview target. These rules are
// intentionally conservative: unknown equivalences are shown for manual review.
const EDUCATION = /\b(?:bachelor(?:['’]s)?|master['’]s|master of|doctorate|doctoral|ph\.?\s?d\.?|mba|m\.?s?\.?p\.?h\.?|high school|secondary school|diploma|ged|associate(?:['’]s)? degree|recent graduate|gpa|undergraduate|postgraduate|graduate degree|academic (?:qualification|background)|educational (?:qualification|background)|education requirements?|education\s*[:：]|(?:university|college) degree|degree (?:in|required|from)|(?:bs|ba|bsc|ms|ma|msc|m\.s\.|b\.s\.|b\.a\.)\s*(?:\/|degree|in\b)|(?:enrolled|pursuing)\b|graduat(?:e|ing|ion) (?:in|by|between|before|after|date|year)|coursework)\b|学历|学位|学士|本科|硕士|博士|大专|专科|在读|毕业|绩点|主修|辅修|相关专业|专业背景|专业要求/i;
export const isEducationRequirement = (r: Pick<Requirement, "text">): boolean => EDUCATION.test(r.text);

export function isEducationQuestion(text: string): boolean {
  return isEducationRequirement({ text }) || /(?:which|what)\s+(?:(?:is|was|your|the|of|highest|academic)\s+)*(?:school|university|college|major|courses|degree)|where\b[^?？]{0,60}\b(?:study|studied|graduate|graduated|college|university|school)|when\b[^?？]{0,60}\bgraduat|你的专业|哪所(?:学校|大学)|什么(?:学校|专业|学位)|修过哪些|学过哪些课程|your\s+(?:highest\s+|academic\s+)?(?:degree|major|school|university|college)|level of education|education level|educational background|field of study|what\b[^?？]{0,50}\b(?:study|studied)/i.test(text);
}

const LEVELS: [number, RegExp][] = [
  [4, /\b(?:ph\.?\s?d\.?|doctorate|doctoral|dphil)\b|博士/i],
  [3, /\b(?:master(?:['’]s)?|m\.?s\.?p\.?h\.?|m\.?p\.?h\.?|m\.?s\.?|m\.?a\.?|msc|meng|mba)\b|硕士|硕士研究生/i],
  [2, /\b(?:bachelor(?:['’]s)?|b\.?s\.?|b\.?a\.?|bsc|beng)\b|本科|学士/i],
  [1, /\bassociate(?:['’]s)?\b|大专|专科/i],
];
function levels(text: string): number[] { return LEVELS.filter(([, pattern]) => pattern.test(text)).map(([level]) => level); }

const SUBJECTS: [string, RegExp][] = [
  ["cs", /computer science|computing|计算机|计算科学/i],
  ["engineering", /\bengineering\b|工程/i],
  ["statistics", /biostatistics|\bstatistics\b|\bstatistical science\b|统计/i],
  ["math", /\bmathematics\b|\bmath\b|数学/i],
  ["physics", /\bphysics\b|物理/i],
  ["data", /data science|数据科学/i],
  ["economics", /\beconomics\b|经济学/i],
  ["business", /business|commerce|商科|工商管理/i],
  ["public-health", /public health|\bm\.?s?\.?p\.?h\.?\b|公共卫生/i],
];
const subjects = (text: string) => SUBJECTS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
const levelName: Record<number, string> = { 1: "专科", 2: "本科", 3: "硕士", 4: "博士" };

function inProgress(e: Education, now: Date): boolean {
  const text = [e.degree, e.end_date].join(" ");
  if (/expected|anticipated|candidate|pursuing|present|预计|预期|在读|至今|目前/i.test(text)) return true;
  const year = e.end_date?.match(/\b(20\d{2})\b/);
  if (!year) return false;
  if (Number(year[1]) !== now.getFullYear()) return Number(year[1]) > now.getFullYear();
  const month = e.end_date?.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
  const zhMonth = e.end_date?.match(/(?:年|[-/])(\d{1,2})(?:月|$)/);
  const n = month ? ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(month[1].toLowerCase()) : zhMonth ? Number(zhMonth[1]) - 1 : null;
  return n !== null && n > now.getMonth();
}

export function renderEducation(education: Education[]): string {
  if (!education.length) return "(用户核对后的教育列表为空；不推断缺失学历，不追问教育细节)";
  return education.map((e) => `[${e.id}] ${JSON.stringify({ school: e.school, degree: e.degree, field: e.field, location: e.location, start_date: e.start_date, end_date: e.end_date, gpa: e.gpa, details: e.details })}`).join("\n");
}

export interface EducationCheck {
  requirement: Requirement;
  status: "matched" | "risk" | "review";
  reason: string;
  evidenceIds: string[];
}

export function checkEducation(r: Requirement, education: Education[], now = new Date()): EducationCheck | null {
  if (!isEducationRequirement(r)) return null;
  const result = (status: EducationCheck["status"], reason: string, rows = education): EducationCheck => ({ requirement: r, status, reason: status !== "matched" && r.kind === "preferred" ? `这是偏好条件，并非硬性门槛。${reason}` : reason, evidenceIds: rows.map((e) => e.id) });
  if (!education.length) return result("review", "已核对的教育列表为空，无法证明这项要求；请自行核实岗位资格，不会追问教育细节。");
  const text = r.text;
  const requiredLevels = levels(text);
  const explicitAlternative = /\bor\b|\/|或者|或|及以上|以上|at least|or higher/i.test(text);
  const target = requiredLevels.length ? (explicitAlternative ? Math.min(...requiredLevels) : Math.max(...requiredLevels)) : null;
  if (requiredLevels.length > 1 && !explicitAlternative) return result("review", "JD 同时列出多项学位条件，需要人工逐项核实；不会通过追问补问教育信息。");
  const targetSubjects = subjects(text);
  const flexible = /related|equivalent|comparable|相关|相近|同等|等效/i.test(text);
  const studyingAllowed = /enrolled|pursuing|currently studying|在读|就读|正在攻读/i.test(text);
  const enrollmentOnly = studyingAllowed && !/\bor\b|或/i.test(text);
  const records = education.map((e) => ({ e, level: Math.max(0, ...levels(e.degree ?? "")), subjects: subjects([e.degree, e.field].join(" ")), pending: inProgress(e, now) }));
  const levelMatches = records.filter((x) => !target || x.level === target || (explicitAlternative && x.level >= target));
  const completeMatches = levelMatches.filter((x) => enrollmentOnly ? x.pending : !target || studyingAllowed || !x.pending);
  if (target && !levelMatches.length) {
    if (records.some((x) => !x.level) || flexible || records.some((x) => x.level > target)) return result("review", `已确认教育信息不能直接证明 JD 的${levelName[target]}要求；学位等同或替代条件需要人工核实，不会追问。`);
    return result("risk", `学历层级风险：JD 要求${levelName[target]}，已确认记录为${[...new Set(records.map((x) => levelName[x.level]))].join("、")}，未找到满足该要求的记录。`);
  }
  if (!completeMatches.length) return result("review", enrollmentOnly ? "在读资格风险：JD 要求当前在读，已确认记录不能证明仍在读；请自行核实资格，不会追问。" : "毕业状态风险：可能对应的学位仍在读或预计毕业，不能当作已取得学位；请核实岗位是否允许在读申请，不会追问。", levelMatches.map((x) => x.e));
  const fieldMatches = completeMatches.filter((x) => !targetSubjects.length || x.subjects.some((s) => targetSubjects.includes(s)));
  if (!fieldMatches.length) {
    if (flexible || completeMatches.some((x) => !x.e.field && !x.subjects.length)) return result("review", "专业匹配风险：已确认专业未直接对应 JD 列举的专业；是否属于相关或同等专业需要人工核实，不会追问。", completeMatches.map((x) => x.e));
    return result("risk", "专业不匹配风险：没有一条已确认教育记录同时满足该学位及明确列举的专业要求。", completeMatches.map((x) => x.e));
  }
  // Do not silently certify qualifications these small deterministic rules cannot prove.
  if (/gpa|绩点|graduat|毕业|degree from|\buniversity\b|\bcollege\b|accredit|认可|认证|排名|top\s*\d|\b(?:19|20)\d{2}\b|\byears?\b|\band\b.*\b(?:python|sql|experience)\b/i.test(text)
      || (!target && !targetSubjects.length)
      || (/(?:专业|\bin\b|major|学位)/i.test(text) && !targetSubjects.length)) {
    return result("review", "这项要求还涉及毕业时间、绩点、专业等需进一步核实的条件；已列出用户确认的信息供对照，不推断满足，也不会追问。", fieldMatches.map((x) => x.e));
  }
  return result("matched", "已确认教育记录与可识别的学位／专业条件对应；不进入经历追问。", fieldMatches.map((x) => x.e));
}

export function educationGap(db: ExperienceDB, requirement: Requirement): Gap | null {
  const check = checkEducation(requirement, db.education ?? []);
  if (!check) return null;
  return { requirement_id: requirement.id, status: check.status === "matched" ? "covered" : check.status === "risk" && requirement.kind === "must_have" ? "true_gap" : "unknown",
    reason: check.reason, evidence_fact_ids: check.evidenceIds, related_card_ids: [] };
}
