import { isResumeSortMode, orderResumeCards } from "@/lib/resume-order";
import { NextResponse } from "next/server";
import { EVALUATION_VERSION } from "@/lib/evaluation-schema";
import { evaluateResume } from "@/lib/evaluation";
import { reviewResume } from "@/lib/review";
import { getMode } from "@/lib/llm";
import {
  analyzeJD,
  applyAnswer,
  askQuestion,
  assembleResume,
  detectGaps,
  matchExperience,
  parseCV,
  pickGap,
  rankCards,
  rewriteBullets,
} from "@/lib/pipeline";
import type { Asked, ExperienceDB, Gap, JDAnalysis } from "@/lib/schema";

export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ mode: getMode(), evaluationVersion: EVALUATION_VERSION });
}

async function analyze(db: ExperienceDB, jd: JDAnalysis, asked: Asked) {
  const matches = await matchExperience(db, jd);
  return { matches, gaps: detectGaps(db, jd, matches, asked) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = getMode();
    const sortMode = body.sortMode ?? "relevance";
    if (!isResumeSortMode(sortMode)) return NextResponse.json({ error: "排序方式无效，请选择 JD 匹配度或经历时间" }, { status: 400 });
    switch (body.step) {
      case "parse": {
        return NextResponse.json({ mode, db: await parseCV(body.cv) });
      }
      case "jd": {
        return NextResponse.json({ mode, jd: await analyzeJD(body.jd) });
      }
      case "analyze": {
        return NextResponse.json({ mode, ...(await analyze(body.db, body.jd, body.asked ?? {})) });
      }
      case "question": {
        const gaps: Gap[] = body.gaps;
        const jd: JDAnalysis = body.jd;
        const gap = pickGap(gaps, jd, body.asked ?? {});
        if (!gap) return NextResponse.json({ mode, done: true });
        const requirement = jd.requirements.find((r) => r.id === gap.requirement_id)!;
        const question = await askQuestion(body.db, gap, requirement, body.history ?? []);
        return NextResponse.json({ mode, gap, requirement, question });
      }
      case "answer": {
        const jd: JDAnalysis = body.jd;
        const requirement = jd.requirements.find((r) => r.id === body.gap.requirement_id)!;
        const applied = await applyAnswer(body.db, body.gap, requirement, body.question, body.answer, body.asked ?? {});
        const { matches, gaps } = await analyze(applied.db, jd, applied.asked);
        return NextResponse.json({ mode, ...applied, matches, gaps });
      }
      case "evaluate": {
        const current = reviewResume(body.db, body.jd, body.gaps, body.rewritten, body.choices ?? {}, sortMode);
        if (!current.resume.markdown.includes("\n- ")) {
          return NextResponse.json({ error: "请先接受至少一条通过校验的经历描述，再进行质量评估" }, { status: 400 });
        }
        if (typeof body.cv !== "string" || !body.cv.trim()) {
          return NextResponse.json({ error: "缺少原简历，无法进行前后对比" }, { status: 400 });
        }
        return NextResponse.json({ evaluation: await evaluateResume(body.cv, current.resume.markdown, body.db, body.jd) });
      }
      case "review": {
        return NextResponse.json({ mode, ...reviewResume(body.db, body.jd, body.gaps, body.rewritten, body.choices ?? {}, sortMode) });
      }
      case "finish": {
        const db: ExperienceDB = body.db;
        const jd: JDAnalysis = body.jd;
        const gaps: Gap[] = body.gaps;
        const candidates = rankCards(db, jd, gaps);
        const ranked = orderResumeCards(candidates, db, sortMode, candidates);
        const rewritten = await rewriteBullets(
          db,
          jd,
          ranked.filter((r) => r.included).map((r) => r.card_id),
        );
        return NextResponse.json({ mode, ranked, rewritten: orderResumeCards(rewritten, db, sortMode, ranked), resume: assembleResume(db, jd, gaps, rewritten, sortMode) });
      }
      default:
        return NextResponse.json({ error: `unknown step: ${body.step}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
