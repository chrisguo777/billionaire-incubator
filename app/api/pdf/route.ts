import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
    }
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx");
    if (!isPdf && !isDocx) {
      return NextResponse.json({ error: "只支持 PDF 或 Word（.docx）文件" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "文件超过 10MB" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = "";
    let pages: number | undefined;
    if (isPdf) {
      try {
        const pdf = await getDocumentProxy(bytes);
        const extracted = await extractText(pdf, { mergePages: true });
        text = extracted.text;
        pages = extracted.totalPages;
      } catch {
        return NextResponse.json({ error: "这个文件不是有效的 PDF，或已损坏" }, { status: 422 });
      }
    } else {
      try {
        const extracted = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        text = extracted.value;
      } catch {
        return NextResponse.json({ error: "这个 Word 文件不是有效的 .docx，或已损坏" }, { status: 422 });
      }
    }
    const cleaned = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length < 30) {
      return NextResponse.json(
        { error: isPdf ? "没有从这份 PDF 里提取到文字，可能是扫描件或图片版简历。请粘贴文字，或换一份可复制文字的 PDF。" : "没有从这份 Word 文档里提取到足够文字，请确认文件是可编辑的 .docx。" },
        { status: 422 },
      );
    }
    return NextResponse.json({ text: cleaned, pages, name: file.name, format: isPdf ? "pdf" : "docx" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `文件解析失败：${message}` }, { status: 500 });
  }
}
