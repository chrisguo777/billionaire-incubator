import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { extractRawText } from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

function decodeTxt(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
  }
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "上传请求无效，请重新选择文件" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "没有收到文件" }, { status: 400 });
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "doc") {
    return NextResponse.json({ error: "暂不支持旧版 .doc，请在 Word 中另存为 .docx 后上传" }, { status: 400 });
  }
  if (extension !== "pdf" && extension !== "docx" && extension !== "txt") {
    return NextResponse.json({ error: "请选择 PDF、Word（.docx）或 TXT 文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "文件超过 10MB" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "文件为空，请选择有文字内容的简历" }, { status: 422 });

  let text: string;
  let pages: number | undefined;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (extension === "pdf") {
      const pdf = await getDocumentProxy(bytes);
      const result = await extractText(pdf, { mergePages: true });
      text = result.text;
      pages = result.totalPages;
    } else if (extension === "docx") {
      text = (await extractRawText({ buffer: Buffer.from(bytes) })).value;
    } else {
      text = decodeTxt(bytes);
      if (text.includes("\0")) throw new Error("Binary content");
    }
  } catch {
    const message = extension === "txt"
      ? "无法读取这份 TXT，请用 UTF-8 编码保存后重新上传"
      : `无法读取这份 ${extension === "pdf" ? "PDF" : "Word（.docx）"} 文件，可能已损坏、受密码保护或格式不符`;
    return NextResponse.json({ error: message }, { status: 422 });
  }
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) {
    const message = extension === "pdf"
      ? "没有提取到文字，可能是扫描件或图片版 PDF。请换一份可复制文字的 PDF，或上传 Word / TXT 文件"
      : "没有提取到文字，请检查文件内容；图片中的文字暂不支持识别";
    return NextResponse.json({ error: message }, { status: 422 });
  }
  return NextResponse.json({ text: cleaned, ...(pages !== undefined ? { pages } : {}), name: file.name });
}
