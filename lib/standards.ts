// 简历规范检查（good resume standard）：全部由代码规则判断，不调用模型，结果每次一致。
// 标准来源：项目文档里整理的「好简历」要求（strong verbs、action + what + method + result、成果量化、
// 风格一致、JD 相关、ATS 可读）。成员 A 的 ATS 规则和成员 B 的 Rubric 定稿后，在这里替换或补充。
// 这里只检查格式和写法，内容质量由「简历质量评估」负责。

import { docToPlainText, type ResumeDoc } from "./resume-doc";
import type { JDAnalysis } from "./schema";

export type StandardStatus = "pass" | "warn" | "fail";

export interface StandardCheck {
  id: string;
  label: string;
  status: StandardStatus;
  detail: string;
}

const WEAK_OPENERS = [
  "responsible", "helped", "help", "assisted", "assist", "worked", "work", "involved", "participated",
  "participate", "tasked", "duties", "did", "was", "were", "am", "is", "handled", "contributed",
];
const NOT_VERBS = ["i", "my", "we", "our", "the", "a", "an", "this", "that", "it", "he", "she", "they"];
const FIRST_PERSON = /\b(i|me|my|mine|we|our|ours)\b/i;
const MAX_BULLET_WORDS = 30;
const MAX_BULLETS_PER_ENTRY = 5;
const MAX_TOTAL_WORDS = 600; // 约一页
const MIN_QUANT_SHARE = 1 / 3;
const MIN_KEYWORD_SHARE = 0.5;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const firstWord = (t: string) => (words(t)[0] ?? "").toLowerCase().replace(/[^a-z-]/g, "");
const quote = (t: string) => `「${t.length > 60 ? t.slice(0, 60) + "…" : t}」`;

export function checkStandards(doc: ResumeDoc, jd: JDAnalysis): StandardCheck[] {
  const experience = doc.sections.find((s) => s.heading === "EXPERIENCE");
  const entries = experience?.entries ?? [];
  const bullets = entries.flatMap((e) => e.bullets);
  const checks: StandardCheck[] = [];
  const add = (id: string, label: string, status: StandardStatus, detail: string) => checks.push({ id, label, status, detail });

  // 1. 章节完整
  const missing = ["EDUCATION", "EXPERIENCE", "SKILLS"].filter((h) => {
    const s = doc.sections.find((x) => x.heading === h);
    return !s || (!s.entries.length && !s.text);
  });
  add("sections", "章节完整（教育、经历、技能）", missing.length ? "warn" : "pass",
    missing.length ? `缺少：${missing.join("、")}` : "三个章节都有内容");

  // 2. 姓名和联系方式
  add("header", "姓名与联系方式抬头", "fail", "目前还没有解析姓名和联系方式，导出的简历缺少抬头，需要手动补上");

  if (!bullets.length) {
    add("bullets", "经历描述", "fail", "还没有已接受的经历描述，接受至少一条后才能检查写法");
    return checks;
  }

  // 3. 以动作动词开头
  const weak = bullets.filter((b) => {
    const w = firstWord(b);
    return WEAK_OPENERS.includes(w) || NOT_VERBS.includes(w);
  });
  add("action-verb", "每条以有力的动作动词开头", weak.length ? "warn" : "pass",
    weak.length ? `${weak.length} 条以弱动词或非动词开头：${weak.map(quote).join("；")}。换动词时不能把「参与」升级成「主导」` : `${bullets.length} 条都以动作动词开头`);

  // 4. 不用第一人称
  const fp = bullets.filter((b) => FIRST_PERSON.test(b));
  add("first-person", "不使用第一人称（I / my / we）", fp.length ? "warn" : "pass",
    fp.length ? `${fp.length} 条出现第一人称：${fp.map(quote).join("；")}` : "没有第一人称");

  // 5. 长度
  const long = bullets.filter((b) => words(b).length > MAX_BULLET_WORDS);
  add("length", `每条不超过 ${MAX_BULLET_WORDS} 个单词`, long.length ? "warn" : "pass",
    long.length ? `${long.length} 条偏长：${long.map((b) => `${quote(b)}（${words(b).length} 词）`).join("；")}` : "长度都在范围内");

  // 6. 每段经历条数
  const crowded = entries.filter((e) => e.bullets.length > MAX_BULLETS_PER_ENTRY);
  add("per-entry", `每段经历 1–${MAX_BULLETS_PER_ENTRY} 条`, crowded.length ? "warn" : "pass",
    crowded.length ? `条数偏多：${crowded.map((e) => `${e.title}（${e.bullets.length} 条）`).join("、")}` : "每段经历条数合适");

  // 7. 量化
  const quantified = bullets.filter((b) => /\d/.test(b)).length;
  add("quantified", "成果有数字支撑", quantified / bullets.length >= MIN_QUANT_SHARE ? "pass" : "warn",
    `${quantified} / ${bullets.length} 条含数字。数字只能来自已确认的事实，不要为了达标编造`);

  // 8. 开头动词不重复
  const counts = new Map<string, number>();
  for (const b of bullets) counts.set(firstWord(b), (counts.get(firstWord(b)) ?? 0) + 1);
  const repeated = [...counts].filter(([w, n]) => w && n > 2);
  add("verb-variety", "开头动词不重复（同一个最多 2 次）", repeated.length ? "warn" : "pass",
    repeated.length ? repeated.map(([w, n]) => `${w} 出现 ${n} 次`).join("、") : "开头动词有变化");

  // 9. 句末标点一致
  const withPeriod = bullets.filter((b) => /[.。]$/.test(b.trim())).length;
  const mixed = withPeriod > 0 && withPeriod < bullets.length;
  add("punctuation", "句末标点统一", mixed ? "warn" : "pass",
    mixed ? `${withPeriod} 条以句号结尾，${bullets.length - withPeriod} 条没有` : "句末标点一致");

  // 10. 日期
  const noDates = entries.filter((e) => !e.dates);
  add("dates", "每段经历写明时间", noDates.length ? "warn" : "pass",
    noDates.length ? `缺少时间：${noDates.map((e) => e.title).join("、")}` : "每段经历都有时间");

  // 11. 篇幅
  const text = docToPlainText(doc);
  const total = words(text).length;
  add("one-page", `篇幅约一页（不超过 ${MAX_TOTAL_WORDS} 词）`, total > MAX_TOTAL_WORDS ? "warn" : "pass",
    `共约 ${total} 词${total > MAX_TOTAL_WORDS ? "，可能超过一页，可以排除匹配度低的条目" : ""}`);

  // 12. JD 关键词
  const lower = text.toLowerCase();
  const keywords = [...new Set(jd.requirements.flatMap((r) => r.keywords.map((k) => k.toLowerCase())))];
  const hit = keywords.filter((k) => lower.includes(k));
  const miss = keywords.filter((k) => !lower.includes(k));
  add("keywords", "覆盖 JD 关键词（ATS 检索）", keywords.length && hit.length / keywords.length >= MIN_KEYWORD_SHARE ? "pass" : "warn",
    `${hit.length} / ${keywords.length} 个关键词出现在简历中${miss.length ? `；未出现：${miss.join("、")}。只在确实做过时才补充` : ""}`);

  return checks;
}
