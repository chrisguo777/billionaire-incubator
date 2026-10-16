import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ error: "只支持 PDF 文件" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "文件超过 10MB" }, { status: 400 });
    }

    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: "这个文件不是有效的 PDF，或已损坏" }, { status: 422 });
    }
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const cleaned = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned.length < 30) {
      return NextResponse.json(
        { error: "没有从这份 PDF 里提取到文字，可能是扫描件或图片版简历。请粘贴文字，或换一份可复制文字的 PDF。" },
        { status: 422 },
      );
    }
    return NextResponse.json({ text: cleaned, pages: totalPages, name: file.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `PDF 解析失败：${message}` }, { status: 500 });
  }
}
