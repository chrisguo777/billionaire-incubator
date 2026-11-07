// 简历的结构化表示：Markdown、网页预览 / PDF（同一份 HTML）、Word 都从这里生成，保证三种格式内容一致。

export interface ResumeEntry {
  title: string; // 加粗的主标题：经历名称或学校
  location: string | null; // 仅教育经历使用，紧跟在学校后面
  position?: string;
  subtitle: string; // 机构或其他经历信息，也可用于学位与专业
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
  contactLines?: string[];
  fileTitle?: string;
  sections: ResumeSection[];
}

function renderSubtitle(
  entry: ResumeEntry,
  renderText: (text: string) => string,
  renderPosition = renderText,
): string {
  return [
    entry.position ? renderPosition(entry.position) : "",
    entry.subtitle ? renderText(entry.subtitle) : "",
  ].filter(Boolean).join(", ");
}

const identity = (text: string) => text;

export function docToMarkdown(doc: ResumeDoc): string {
  const lines: string[] = [`# ${doc.title}`, "", ...(doc.contactLines ?? []).flatMap((line) => [line, ""])];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`, "");
    for (const e of s.entries) {
      const head = `**${e.title}**${e.location ? `, ${e.location}` : ""}`;
      const subtitle = renderSubtitle(e, identity, (position) => `**${position}**`);
      lines.push(`${head}${subtitle ? ` — ${subtitle}` : ""}${e.dates ? ` (${e.dates})` : ""}`);
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
    .flatMap((s) => [s.heading, ...s.entries.flatMap((e) => [e.title, e.location ?? "", renderSubtitle(e, identity), e.dates, ...e.bullets]), s.text ?? ""])
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
  ${e.position || e.subtitle ? `<div class="subtitle">${renderSubtitle(e, esc, (position) => `<strong>${esc(position)}</strong>`)}</div>` : ""}
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
  @page { size: Letter; margin: 0 0.6in; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body { margin: 0; padding: 0.6in; color: #111; background: #fff; font: 10.5pt/1.35 Calibri, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
  @media print {
    body { padding: 0; }
    /* Keep space inside each page while leaving no room for browser headers and footers. */
    .resume { padding-block: 0.6in; box-decoration-break: clone; }
  }
  h1 { font-size: 16pt; margin: 0 0 4pt; text-align: center; }
  .contact { margin: 0; text-align: center; overflow-wrap: anywhere; }
  h2 { font-size: 10.5pt; letter-spacing: 0.08em; margin: 10pt 0 4pt; padding-bottom: 2pt; border-bottom: 1px solid #111; }
  .entry { margin: 0 0 6pt; break-inside: avoid; }
  .head { display: flex; justify-content: space-between; gap: 12pt; }
  .dates { white-space: nowrap; }
  .subtitle { font-style: italic; }
  ul { margin: 2pt 0 0; padding-left: 14pt; }
  li { margin: 1pt 0; }
  .text { margin: 0; }
</style></head>
<body><main class="resume"><div class="resume-content"><header><h1>${esc(doc.title)}</h1>
${(doc.contactLines ?? []).map((line) => `<p class="contact">${esc(line)}</p>`).join("\n")}</header>
${body}
</div></main></body></html>`;
}

/** Fit the preview at the physical Letter print width, even in a narrow browser window. */
export function fitResumeToOnePage(document: Document): number {
  const resume = document.querySelector<HTMLElement>(".resume");
  const content = document.querySelector<HTMLElement>(".resume-content");
  if (!resume || !content) return 1;

  const pageMargin = 0.6;
  const printableHeight = (11 - 2 * pageMargin) * 96 - 2; // Leave room for browser rounding.
  resume.style.width = `${8.5 - 2 * pageMargin}in`;
  content.style.display = "flow-root";
  content.style.overflowWrap = "anywhere";

  const measure = (scale: number) => {
    content.style.zoom = String(scale);
    return content.getBoundingClientRect().height;
  };

  let scale = 1;
  const originalHeight = measure(1);
  if (originalHeight > printableHeight) {
    let low = Math.min(1, printableHeight / originalHeight) * 0.99;
    let high = 1;
    while (measure(low) > printableHeight) low /= 2;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (measure(mid) <= printableHeight) low = mid;
      else high = mid;
    }
    scale = low;
    measure(scale);
  }

  // Let the on-screen preview stay responsive; the print page provides the measured width.
  resume.style.removeProperty("width");
  return scale;
}

export function resumeFileName(doc: ResumeDoc, ext: string): string {
  const base = (doc.fileTitle ?? doc.title).replace(/[\\/:*?"<>|—–]+/g, " ").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return `${base || "resume"}.${ext}`;
}
