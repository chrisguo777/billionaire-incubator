import { Document, Packer, Paragraph, TextRun } from "docx";
import { contactLines, type Contact, type ContactMode } from "./privacy";

export async function buildResumeWord(markdown: string, mode: ContactMode, contact: Contact) {
  const identity = contactLines(mode, contact).map((text, i) => new Paragraph({
    spacing: { after: i === 0 ? 100 : 160 },
    children: [new TextRun({ text, bold: i === 0, size: i === 0 ? 32 : 22,
      ...(mode === "private" ? { highlight: "yellow" as const } : {}) })],
  }));
  const body = markdown.split("\n").filter((line) => !line.startsWith("# ")).map((line) => {
    const heading = line.startsWith("## ");
    const bullet = line.startsWith("- ");
    const text = line.replace(/^## /, "").replace(/^- /, "");
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return new Paragraph({ spacing: { before: heading ? 180 : 0, after: 80 }, keepNext: heading,
      ...(bullet ? { bullet: { level: 0 } } : {}),
      children: parts.map((part) => new TextRun({ text: part.replace(/\*\*/g, ""), bold: heading || part.startsWith("**") })),
    });
  });
  const doc = new Document({ creator: "Resume Agent", title: "Resume", styles: { default: {
    document: { run: { font: "Arial", size: 22, color: "000000" } },
  } }, sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: [...identity, ...body] }] });
  return Packer.toBuffer(doc);
}
