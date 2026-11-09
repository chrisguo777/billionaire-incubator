// 两种语言分开处理：
// - 沟通语言（chat language）：用户在页面上选，只决定追问用中文还是英文。
// - 简历目标语言（resume language）：解析时根据上传的简历自动识别，存在经历库里；
//   回答抽取成事实、改写 bullet、最终简历的章节标题都统一用这个语言。
// 识别和检查都是代码规则，不调用模型。

export type Lang = "zh" | "en";

export const LANGS: Lang[] = ["zh", "en"];
export const LANG_LABEL: Record<Lang, string> = { zh: "中文", en: "English" };
// 写进提示词里的语言名
export const LANG_PROMPT_NAME: Record<Lang, string> = { zh: "Simplified Chinese", en: "English" };

export const isLang = (v: unknown): v is Lang => v === "zh" || v === "en";

const HAN = /\p{Script=Han}/gu;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

const hanCount = (t: string) => t.match(HAN)?.length ?? 0;
const latinWords = (t: string) => t.match(LATIN_WORD)?.length ?? 0;

/** 汉字数不少于英文单词数就算中文简历。中文简历里常夹着 Python、SQL 这类词，英文简历偶尔有中文姓名，都不影响判断。 */
export function detectLanguage(text: string): Lang {
  const han = hanCount(text);
  if (!han) return "en";
  return han >= latinWords(text) ? "zh" : "en";
}

/**
 * 判断一段文字是否不符合目标语言。
 * - 英文简历：出现任何汉字都算。
 * - 中文简历：整句以英文为主（至少 4 个英文单词，且多于汉字）才算；工具名、公司名这类夹杂的英文不算。
 */
export function isForeign(text: string, lang: Lang): boolean {
  if (lang === "en") return hanCount(text) > 0;
  const words = latinWords(text);
  return words >= 4 && words > hanCount(text);
}

export const SECTION_HEADINGS: Record<Lang, { education: string; experience: string; skills: string }> = {
  en: { education: "EDUCATION", experience: "EXPERIENCE", skills: "SKILLS" },
  zh: { education: "教育经历", experience: "经历", skills: "技能" },
};

export function resumeTitle(lang: Lang, role: string): string {
  return lang === "zh" ? `定向简历 — ${role}` : `Targeted resume — ${role}`;
}
