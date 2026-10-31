import { z } from "zod";
import { ContactSchema, EMPTY_CONTACT, validateContact } from "@/lib/privacy";
import { buildResumeWord } from "@/lib/word-export";
import { reviewResume } from "@/lib/review";

export const runtime = "nodejs";
const RequestSchema = z.object({
  mode: z.enum(["full", "private"]), contact: ContactSchema.optional(), acknowledged: z.boolean(),
  db: z.any(), jd: z.any(), gaps: z.array(z.any()), rewritten: z.array(z.any()), choices: z.record(z.string(), z.any()),
});

export async function POST(req: Request) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "导出请求无效，请重新检查个人信息模式。" }, { status: 400 });
    const body = parsed.data;
    if (body.mode === "private" && !body.acknowledged) return Response.json({ error: "请先确认下载后自行替换所有黄色占位信息。" }, { status: 400 });
    const contact = body.mode === "private" ? EMPTY_CONTACT : ContactSchema.parse(body.contact);
    const issue = body.mode === "full" ? validateContact(contact) : null;
    if (issue) return Response.json({ error: issue }, { status: 400 });
    // Recompute from accepted, validated bullets. Never export a client-supplied final draft.
    const { resume, rewritten } = reviewResume(body.db, body.jd, body.gaps, body.rewritten, body.choices);
    const accepted = rewritten.some((card) => card.bullets.some((bullet, i) => bullet.ok && body.choices[`${card.card_id}:${i}`]?.status === "accepted"));
    if (!accepted || !resume.markdown.includes("\n- ")) return Response.json({ error: "请先接受至少一条通过校验的经历描述。" }, { status: 400 });
    const bytes = await buildResumeWord(resume.markdown, body.mode, contact);
    const filename = body.mode === "private" ? "Resume-待填写个人信息.docx" : "Resume.docx";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Resume.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    } });
  } catch {
    return Response.json({ error: "无法导出，请检查简历与个人信息后重试。" }, { status: 400 });
  }
}
