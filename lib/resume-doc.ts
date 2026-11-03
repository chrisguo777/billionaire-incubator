// 简历的结构化表示：Markdown、网页预览 / PDF（同一份 HTML）、Word 都从这里生成，保证三种格式内容一致。

export interface ResumeEntry {
  title: string; // 加粗的主标题：经历名称或学校
  location: string | null; // 仅教育经历使用，紧跟在学校后面
  subtitle: string; // 职位与机构，或学位与专业
  dates: string;
  bullets: string[];
}

export interface ResumeSection {
  heading: string; // EDUCATION / EXPERIENCE / SKILLS
  entries: ResumeEntry[];
  text: string | null; // SKILLS 这类整段文字
}

export interface ResumeDoc {
  title: string;
  sections: ResumeSection[];
}

export function docToMarkdown(doc: ResumeDoc): string {
  const lines: string[] = [`# ${doc.title}`, ""];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`, "");
    for (const e of s.entries) {
      const head = `**${e.title}**${e.location ? `, ${e.location}` : ""}`;
      lines.push(`${head}${e.subtitle ? ` — ${e.subtitle}` : ""}${e.dates ? ` (${e.dates})` : ""}`);
      for (const b of e.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
    if (s.text) lines.push(s.text, "");
  }
  return lines.join("\n");
}

/** 纯文本，用于字数统计和关键词检查。 */
export function docToPlainText(doc: ResumeDoc): string {
  return doc.sections
    .flatMap((s) => [s.heading, ...s.entries.flatMap((e) => [e.title, e.location ?? "", e.subtitle, e.dates, ...e.bullets]), s.text ?? ""])
    .filter(Boolean)
    .join("\n");
}

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 独立的 HTML 页面：网页里的预览和导出 PDF（浏览器打印）用的是同一份，所见即所得。 */
export function docToHTML(doc: ResumeDoc): string {
  const body = doc.sections
    .map((s) => {
      const entries = s.entries
        .map(
          (e) => `<div class="entry">
  <div class="head"><span class="title"><b>${esc(e.title)}</b>${e.location ? `, ${esc(e.location)}` : ""}</span><span class="dates">${esc(e.dates)}</span></div>
  ${e.subtitle ? `<div class="subtitle">${esc(e.subtitle)}</div>` : ""}
  ${e.bullets.length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
</div>`,
        )
        .join("\n");
      return `<section><h2>${esc(s.heading)}</h2>${entries}${s.text ? `<p class="text">${esc(s.text)}</p>` : ""}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
  @page { size: Letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body { margin: 0; padding: 0.6in; color: #111; background: #fff; font: 10.5pt/1.35 Calibri, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
  @media print { body { padding: 0; } }
  h1 { font-size: 16pt; margin: 0 0 8pt; text-align: center; }
  h2 { font-size: 10.5pt; letter-spacing: 0.08em; margin: 10pt 0 4pt; padding-bottom: 2pt; border-bottom: 1px solid #111; }
  .entry { margin: 0 0 6pt; break-inside: avoid; }
  .head { display: flex; justify-content: space-between; gap: 12pt; }
  .dates { white-space: nowrap; }
  .subtitle { font-style: italic; }
  ul { margin: 2pt 0 0; padding-left: 14pt; }
  li { margin: 1pt 0; }
  .text { margin: 0; }
</style></head>
<body><h1>${esc(doc.title)}</h1>
${body}
</body></html>`;
}

export function resumeFileName(doc: ResumeDoc, ext: string): string {
  const base = doc.title.replace(/[\\/:*?"<>|—–]+/g, " ").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return `${base || "resume"}.${ext}`;
}
